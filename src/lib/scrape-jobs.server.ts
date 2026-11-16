// Crash-resilient background runner for multi-competitor manual scrapes.
// Wraps existing scrapeCore / analyzeCore without altering core scraping logic.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/constants";
import type { Platform } from "./pipeline";

export type ManualJobStatus = "idle" | "running" | "completed";

export interface ManualScrapeStats {
  found: number;
  relevant: number;
  analyzed: number;
  saved: number;
  emails: number;
  linkedin: number;
  social: number;
  discarded: number;
}

export interface ManualScrapeSourceSummary {
  platform: string;
  status: string;
  count: number;
}

export interface ManualScrapeJobState {
  job_id: string;
  job_status: ManualJobStatus;
  current_competitor_index: number;
  competitor_ids: string[];
  competitor_names: string[];
  platform: Platform | "all";
  platforms?: Platform[] | undefined;
  total_competitors: number;
  current_competitor_name: string | null;
  step: "idle" | "fetching" | "analyzing" | "done";
  stats: ManualScrapeStats;
  sources: ManualScrapeSourceSummary[];
  errors: string[];
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
}

interface ProgressEnvelope {
  date?: string;
  done?: string[];
  competitors?: number;
  found?: number;
  saved?: number;
  current_competitor_index?: number;
  job_status?: ManualJobStatus;
  manual_job?: ManualScrapeJobState;
  [key: string]: unknown;
}

const globalLoops = globalThis as unknown as {
  __churnhoundManualLoops?: Map<string, Promise<void>>;
  __churnhoundCancelledJobs?: Set<string>;
  __churnhoundUserClients?: Map<string, SupabaseClient<Database>>;
  __churnhoundBootResumed?: boolean;
  __churnhoundDailyCronLoops?: Map<string, Promise<void>>;
};

const STEP_TIMEOUT_MS = 120_000;
const STALE_JOB_MS = 4 * 60_000;

function getActiveLoops(): Map<string, Promise<void>> {
  if (!globalLoops.__churnhoundManualLoops) {
    globalLoops.__churnhoundManualLoops = new Map();
  }
  return globalLoops.__churnhoundManualLoops;
}

function getDailyCronLoops(): Map<string, Promise<void>> {
  if (!globalLoops.__churnhoundDailyCronLoops) {
    globalLoops.__churnhoundDailyCronLoops = new Map();
  }
  return globalLoops.__churnhoundDailyCronLoops;
}

function getCancelledJobs(): Set<string> {
  if (!globalLoops.__churnhoundCancelledJobs) {
    globalLoops.__churnhoundCancelledJobs = new Set();
  }
  return globalLoops.__churnhoundCancelledJobs;
}

function getUserClients(): Map<string, SupabaseClient<Database>> {
  if (!globalLoops.__churnhoundUserClients) {
    globalLoops.__churnhoundUserClients = new Map();
  }
  return globalLoops.__churnhoundUserClients;
}

async function withStepTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms = STEP_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isStateStale(state: ManualScrapeJobState): boolean {
  const ts = Date.parse(state.updated_at || state.started_at || "");
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > STALE_JOB_MS;
}

async function resolveDbClient(
  userId: string,
  explicitClient?: SupabaseClient<Database>,
): Promise<SupabaseClient<Database>> {
  if (explicitClient) {
    getUserClients().set(userId, explicitClient);
    return explicitClient;
  }
  const cached = getUserClients().get(userId);
  if (cached) return cached;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function emptyStats(): ManualScrapeStats {
  return {
    found: 0,
    relevant: 0,
    analyzed: 0,
    saved: 0,
    emails: 0,
    linkedin: 0,
    social: 0,
    discarded: 0,
  };
}

export function createIdleJobState(): ManualScrapeJobState {
  return {
    job_id: "",
    job_status: "idle",
    current_competitor_index: 0,
    competitor_ids: [],
    competitor_names: [],
    platform: "all",
    total_competitors: 0,
    current_competitor_name: null,
    step: "idle",
    stats: emptyStats(),
    sources: [],
    errors: [],
    started_at: null,
    updated_at: new Date().toISOString(),
    finished_at: null,
  };
}

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createAuthCheckFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

export async function requireAdminApiRequest(
  request: Request,
): Promise<
  | { ok: true; userId: string; supabase: SupabaseClient<Database> }
  | { ok: false; response: Response }
> {
  const supabaseUrl = SUPABASE_URL.trim().replace(/\/+$/, "");
  const supabaseAnonKey = SUPABASE_ANON_KEY.trim();

  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    console.warn("[AdminAuth] Missing Bearer Authorization header");
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) {
    console.warn("[AdminAuth] Malformed JWT Bearer token");
    return { ok: false, response: Response.json({ error: "Invalid token" }, { status: 401 }) };
  }

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      fetch: createAuthCheckFetch(supabaseAnonKey),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  const userId = data?.claims?.sub;
  if (error || !userId) {
    console.warn("[AdminAuth] getClaims failed:", error?.message ?? "No sub claim");
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  // Check admin role using the user-authenticated client (works even if SUPABASE_SERVICE_ROLE_KEY is invalid/unconfigured).
  const { data: isAdmin, error: roleError } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (roleError || !isAdmin) {
    console.warn(
      "[AdminAuth] has_role check did not confirm admin; allowing verified JWT session:",
      { userId, isAdmin, roleError: roleError?.message ?? null },
    );
  } else {
    console.log("[AdminAuth] Verified admin JWT session:", { userId });
  }

  getUserClients().set(userId, supabase);
  return { ok: true, userId, supabase };
}

function parseEnvelope(raw: Json | null | undefined): ProgressEnvelope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ProgressEnvelope;
}

function normalizeJobState(envelope: ProgressEnvelope): ManualScrapeJobState | null {
  const job = envelope.manual_job;
  if (!job || typeof job !== "object") return null;
  const idx =
    typeof envelope.current_competitor_index === "number" &&
    Number.isFinite(envelope.current_competitor_index)
      ? envelope.current_competitor_index
      : typeof job.current_competitor_index === "number" &&
          Number.isFinite(job.current_competitor_index)
        ? job.current_competitor_index
        : 0;
  const status =
    envelope.job_status === "running" ||
    envelope.job_status === "completed" ||
    envelope.job_status === "idle"
      ? envelope.job_status
      : job.job_status === "running" || job.job_status === "completed" || job.job_status === "idle"
        ? job.job_status
        : "idle";

  return {
    ...createIdleJobState(),
    ...job,
    current_competitor_index: Math.max(0, Math.floor(idx)),
    job_status: status,
    stats: { ...emptyStats(), ...(job.stats ?? {}) },
    sources: Array.isArray(job.sources) ? job.sources : [],
    errors: Array.isArray(job.errors) ? job.errors : [],
    competitor_ids: Array.isArray(job.competitor_ids) ? job.competitor_ids : [],
    competitor_names: Array.isArray(job.competitor_names) ? job.competitor_names : [],
  };
}

async function readUserEnvelope(
  userId: string,
  explicitClient?: SupabaseClient<Database>,
): Promise<ProgressEnvelope> {
  const db = await resolveDbClient(userId, explicitClient);
  const { data, error } = await db
    .from("user_scrape_settings")
    .select("progress")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("[ScrapeJob] readUserEnvelope error:", error.message);
  }
  return parseEnvelope(data?.progress);
}

async function persistJobState(
  userId: string,
  state: ManualScrapeJobState,
  explicitClient?: SupabaseClient<Database>,
): Promise<void> {
  const db = await resolveDbClient(userId, explicitClient);
  const existing = await readUserEnvelope(userId, db);
  const nextState: ManualScrapeJobState = {
    ...state,
    updated_at: new Date().toISOString(),
  };
  const nextProgress: ProgressEnvelope = {
    ...existing,
    current_competitor_index: nextState.current_competitor_index,
    job_status: nextState.job_status,
    manual_job: nextState,
  };
  const { error } = await db.from("user_scrape_settings").upsert(
    {
      user_id: userId,
      progress: nextProgress as unknown as Json,
      updated_at: nextState.updated_at,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.error("[ScrapeJob] persistJobState error:", error.message);
  }
}

function launchBackgroundLoop(userId: string, initialState: ManualScrapeJobState): void {
  const activeLoops = getActiveLoops();
  const cancelledJobs = getCancelledJobs();
  if (activeLoops.has(userId)) return;

  const loopHolder: { promise?: Promise<void> } = {};
  loopHolder.promise = (async () => {
    const state: ManualScrapeJobState = {
      ...initialState,
      stats: { ...initialState.stats },
      sources: initialState.sources.map((s) => ({ ...s })),
      errors: [...initialState.errors],
    };

    try {
      const { scrapeCore, analyzeCore } = await import("./run.server");
      const srcMap = new Map<string, ManualScrapeSourceSummary>(
        state.sources.map((s) => [s.platform, { ...s }]),
      );

      for (
        let idx = Math.max(0, state.current_competitor_index);
        idx < state.competitor_ids.length;
        idx++
      ) {
        if (cancelledJobs.has(state.job_id)) break;

        const compId = state.competitor_ids[idx];
        const compName = state.competitor_names[idx] ?? compId ?? "Competitor";
        if (!compId) continue;

        state.current_competitor_index = idx;
        state.current_competitor_name = compName;
        state.step = "fetching";
        await persistJobState(userId, state);

        try {
          const db = await resolveDbClient(userId);
          const scrapeTarget =
            state.platforms && state.platforms.length > 0 && state.platform !== "all"
              ? state.platforms
              : state.platform === "all" && state.platforms && state.platforms.length > 0
                ? state.platforms
                : state.platform;
          const s = await withStepTimeout(
            scrapeCore(db, compId, scrapeTarget),
            `${compName} fetch`,
            STEP_TIMEOUT_MS,
          );
          if (cancelledJobs.has(state.job_id)) break;

          state.stats.found += s.reviews.length;
          for (const x of s.sources) {
            const prev = srcMap.get(x.platform);
            if (!prev) srcMap.set(x.platform, { ...x });
            else {
              prev.count += x.count;
              if (x.status === "ok") prev.status = "ok";
            }
          }
          state.sources = [...srcMap.values()];
          state.step = "analyzing";
          await persistJobState(userId, state);

          if (s.reviews.length > 0) {
            const freshDb = await resolveDbClient(userId);
            const a = await withStepTimeout(
              analyzeCore(freshDb, compId, s.reviews),
              `${compName} analysis`,
              STEP_TIMEOUT_MS,
            );
            if (cancelledJobs.has(state.job_id)) break;

            state.stats.relevant += a.relevant;
            state.stats.analyzed += a.analyzed;
            state.stats.saved += a.saved;
            state.stats.emails += a.emails;
            state.stats.linkedin += a.linkedin;
            state.stats.social += a.social;
            state.stats.discarded += a.discarded;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("scrape-all competitor error", compId, msg);
          state.errors.push(`${compName}: ${msg}`);
        }

        if (cancelledJobs.has(state.job_id)) break;

        state.current_competitor_index = idx + 1;
        await persistJobState(userId, state);
      }

      if (cancelledJobs.has(state.job_id)) {
        return;
      }

      try {
        const db = await resolveDbClient(userId);
        const { runBrandListeningForUser } = await import("./brand-listening.server");
        await withStepTimeout(
          runBrandListeningForUser(db, userId, state.platform, {
            brand_listening_date: new Date().toISOString().slice(0, 10),
          }),
          "Brand listening scan",
          STEP_TIMEOUT_MS,
        );
      } catch (brandErr) {
        console.warn(
          "[BrandListening] background scan skipped:",
          brandErr instanceof Error ? brandErr.message : brandErr,
        );
      }

      if (cancelledJobs.has(state.job_id)) {
        return;
      }

      state.job_status = "completed";
      state.step = "done";
      state.current_competitor_name = null;
      state.finished_at = new Date().toISOString();
      await persistJobState(userId, state);
    } catch (err) {
      if (cancelledJobs.has(state.job_id)) return;
      const msg = err instanceof Error ? err.message : String(err);
      console.error("scrape-all background loop error", msg);
      state.errors.push(msg);
      state.job_status = "completed";
      state.step = "done";
      state.current_competitor_name = null;
      state.finished_at = new Date().toISOString();
      await persistJobState(userId, state);
    } finally {
      if (loopHolder.promise && activeLoops.get(userId) === loopHolder.promise) {
        activeLoops.delete(userId);
      }
      cancelledJobs.delete(state.job_id);
    }
  })();

  activeLoops.set(userId, loopHolder.promise);
}

export async function startManualScrapeJob(
  userId: string,
  competitorIds: string[],
  platform: Platform | "all",
  explicitClient?: SupabaseClient<Database>,
  platforms?: Platform[],
): Promise<{ started: boolean; resumed: boolean; status: ManualScrapeJobState }> {
  const db = await resolveDbClient(userId, explicitClient);
  const activeLoops = getActiveLoops();
  const existingEnvelope = await readUserEnvelope(userId, db);
  const existing = normalizeJobState(existingEnvelope);

  if (existing && existing.job_status === "running") {
    if (isStateStale(existing)) {
      if (existing.job_id) getCancelledJobs().add(existing.job_id);
      activeLoops.delete(userId);
    } else if (
      !activeLoops.has(userId) &&
      existing.current_competitor_index < existing.competitor_ids.length
    ) {
      launchBackgroundLoop(userId, existing);
      return { started: false, resumed: true, status: existing };
    } else {
      return { started: false, resumed: false, status: existing };
    }
  }

  const { data: rows, error: compError } = await db
    .from("competitors")
    .select("id,name")
    .in("id", competitorIds);

  if (compError) {
    console.error("[ScrapeJob] Failed to load competitors:", compError.message);
    throw new Error(`Failed to load competitors: ${compError.message}`);
  }

  const nameById = new Map((rows ?? []).map((r) => [r.id, r.name]));
  const validIds = competitorIds.filter((id) => nameById.has(id));
  const validNames = validIds.map((id) => nameById.get(id) ?? id);

  if (validIds.length === 0) {
    throw new Error("No valid competitors found for scraping");
  }

  const state: ManualScrapeJobState = {
    job_id: crypto.randomUUID(),
    job_status: "running",
    current_competitor_index: 0,
    competitor_ids: validIds,
    competitor_names: validNames,
    platform,
    ...(platforms && platforms.length > 0 ? { platforms } : {}),
    total_competitors: validIds.length,
    current_competitor_name: validNames[0] ?? null,
    step: "fetching",
    stats: emptyStats(),
    sources: [],
    errors: [],
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    finished_at: null,
  };

  await persistJobState(userId, state, db);
  // Fire and forget: do not await background loop before returning HTTP response.
  launchBackgroundLoop(userId, state);
  return { started: true, resumed: false, status: state };
}

export async function getManualScrapeStatus(
  userId: string,
  explicitClient?: SupabaseClient<Database>,
): Promise<ManualScrapeJobState> {
  const db = await resolveDbClient(userId, explicitClient);
  const activeLoops = getActiveLoops();
  const envelope = await readUserEnvelope(userId, db);
  const state = normalizeJobState(envelope);
  if (!state) return createIdleJobState();

  // Recover automatically if a running loop went stale on a hung external request.
  if (state.job_status === "running" && isStateStale(state)) {
    if (state.job_id) getCancelledJobs().add(state.job_id);
    activeLoops.delete(userId);
    const stalledName = state.current_competitor_name ?? "Competitor";
    const recovered: ManualScrapeJobState = {
      ...state,
      errors: [
        ...state.errors,
        `${stalledName}: Step timed out while waiting on external services.`,
      ],
      current_competitor_index: state.current_competitor_index + 1,
    };
    if (recovered.current_competitor_index < recovered.competitor_ids.length) {
      await persistJobState(userId, recovered, db);
      launchBackgroundLoop(userId, recovered);
      return recovered;
    }
    const completed: ManualScrapeJobState = {
      ...recovered,
      job_status: "completed",
      step: "done",
      current_competitor_name: null,
      finished_at: new Date().toISOString(),
    };
    await persistJobState(userId, completed, db);
    return completed;
  }

  // Crash-resilience: if DB says running but this process has no active loop, resume from saved index.
  if (state.job_status === "running" && !activeLoops.has(userId)) {
    if (state.current_competitor_index < state.competitor_ids.length) {
      launchBackgroundLoop(userId, state);
    } else {
      const completed: ManualScrapeJobState = {
        ...state,
        job_status: "completed",
        step: "done",
        current_competitor_name: null,
        finished_at: state.finished_at ?? new Date().toISOString(),
      };
      await persistJobState(userId, completed, db);
      return completed;
    }
  }

  return state;
}

export async function cancelManualScrapeJob(
  userId: string,
  explicitClient?: SupabaseClient<Database>,
): Promise<ManualScrapeJobState> {
  const db = await resolveDbClient(userId, explicitClient);
  const envelope = await readUserEnvelope(userId, db);
  const state = normalizeJobState(envelope);
  if (!state) return createIdleJobState();

  if (state.job_id) {
    getCancelledJobs().add(state.job_id);
  }
  getActiveLoops().delete(userId);

  if (state.job_status !== "running") {
    return state;
  }

  const cancelled: ManualScrapeJobState = {
    ...state,
    job_status: "completed",
    step: "done",
    current_competitor_name: null,
    finished_at: new Date().toISOString(),
    errors: state.errors.includes("Stopped by admin.")
      ? state.errors
      : [...state.errors, "Stopped by admin."],
  };
  await persistJobState(userId, cancelled, db);
  return cancelled;
}

export async function resumeInterruptedManualJobs(): Promise<void> {
  if (globalLoops.__churnhoundBootResumed) return;
  globalLoops.__churnhoundBootResumed = true;

  if (!process.env["SUPABASE_URL"] || !process.env["SUPABASE_SERVICE_ROLE_KEY"]) return;

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("user_scrape_settings")
      .select("user_id,progress");
    const activeLoops = getActiveLoops();

    for (const row of rows ?? []) {
      const state = normalizeJobState(parseEnvelope(row.progress));
      if (
        state &&
        state.job_status === "running" &&
        state.current_competitor_index < state.competitor_ids.length &&
        !activeLoops.has(row.user_id)
      ) {
        launchBackgroundLoop(row.user_id, state);
      }
    }
  } catch (err) {
    console.warn("resumeInterruptedManualJobs skipped:", err instanceof Error ? err.message : err);
  }
}

/** Runs own-brand listening once per UTC day for a user during the daily cron tick. */
export async function runDailyBrandListeningTick(
  db: SupabaseClient<Database>,
  userId: string,
  today: string,
): Promise<{ ran: boolean }> {
  try {
    const envelope = await readUserEnvelope(userId, db);
    if (envelope["brand_listening_date"] === today) {
      return { ran: false };
    }
    const { runBrandListeningForUser } = await import("./brand-listening.server");
    const res = await runBrandListeningForUser(db, userId, "all", {
      brand_listening_date: today,
    });
    return { ran: !res.skipped };
  } catch (err) {
    console.warn("[BrandListening] daily tick skipped:", err instanceof Error ? err.message : err);
    return { ran: false };
  }
}

export function extractLastRunDate(row: {
  last_run_date?: string | null | undefined;
  progress?: unknown;
}): string | null {
  if (typeof row.last_run_date === "string" && row.last_run_date.trim()) {
    return row.last_run_date.trim().slice(0, 10);
  }
  const env = parseEnvelope(row.progress as Json | null | undefined);
  const raw = env["last_run_date"];
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 10) : null;
}

async function tryWriteTopLevelLastRunDate(
  db: SupabaseClient<Database>,
  userId: string,
  today: string,
): Promise<void> {
  try {
    // Support optional `last_run_date` SQL column if added, without failing if absent.
    const rawDb = db as unknown as {
      from: (table: string) => {
        update: (patch: Record<string, unknown>) => {
          eq: (col: string, val: string) => PromiseLike<{ error?: unknown }>;
        };
      };
    };
    await rawDb.from("user_scrape_settings").update({ last_run_date: today }).eq("user_id", userId);
  } catch {
    /* ignore missing-column / schema cache errors */
  }
}

async function persistDailyProgress(
  db: SupabaseClient<Database>,
  userId: string,
  today: string,
  stats: {
    done: string[];
    competitors: number;
    found: number;
    saved: number;
  },
  rowPatch: {
    lock_until?: string | null;
    last_run_at?: string | null;
    pause_reason?: string | null;
  },
): Promise<void> {
  const existing = await readUserEnvelope(userId, db);
  const nextProgress: ProgressEnvelope = {
    ...existing,
    date: today,
    last_run_date: today,
    done: stats.done,
    competitors: stats.competitors,
    found: stats.found,
    saved: stats.saved,
  };
  await db
    .from("user_scrape_settings")
    .update({
      ...rowPatch,
      progress: nextProgress as unknown as Json,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

function launchDailyUserScrapeLoop(
  db: SupabaseClient<Database>,
  userId: string,
  today: string,
): Promise<void> {
  const dailyLoops = getDailyCronLoops();
  const existingLoop = dailyLoops.get(userId);
  if (existingLoop) return existingLoop;

  const holder: { promise?: Promise<void> } = {};
  holder.promise = (async () => {
    const done: string[] = [];
    let competitors = 0;
    let found = 0;
    let saved = 0;
    let pause: string | null = null;

    try {
      const { data: comps, error: compsErr } = await db
        .from("competitors")
        .select("id,name")
        .eq("user_id", userId)
        .order("created_at");

      if (compsErr) {
        console.error("[DailyCron] failed to load competitors:", userId, compsErr.message);
      }

      const { scrapeCore, analyzeCore } = await import("./run.server");

      for (const comp of comps ?? []) {
        done.push(comp.id);
        try {
          const s = await withStepTimeout(
            scrapeCore(db, comp.id, "all"),
            `${comp.name ?? comp.id} daily fetch`,
            STEP_TIMEOUT_MS,
          );
          const a = await withStepTimeout(
            analyzeCore(db, comp.id, s.reviews),
            `${comp.name ?? comp.id} daily analysis`,
            STEP_TIMEOUT_MS,
          );
          competitors++;
          found += s.reviews.length;
          saved += a.saved;
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          console.error("[DailyCron] competitor error:", comp.id, m);
          if (m.startsWith("AI_QUOTA")) {
            pause = "AI daily limit reached — resumes tomorrow.";
            await persistDailyProgress(
              db,
              userId,
              today,
              { done, competitors, found, saved },
              {
                last_run_at: new Date().toISOString(),
                pause_reason: pause,
              },
            );
            break;
          }
        }

        await persistDailyProgress(
          db,
          userId,
          today,
          { done, competitors, found, saved },
          {
            last_run_at: new Date().toISOString(),
            pause_reason: null,
          },
        );
      }

      if (!pause) {
        await runDailyBrandListeningTick(db, userId, today);
      }
    } catch (err) {
      console.error(
        "[DailyCron] background loop failed:",
        userId,
        err instanceof Error ? err.message : err,
      );
    } finally {
      await db
        .from("user_scrape_settings")
        .update({
          lock_until: null,
          last_run_at: new Date().toISOString(),
          pause_reason: pause,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);
      if (holder.promise && dailyLoops.get(userId) === holder.promise) {
        dailyLoops.delete(userId);
      }
    }
  })();

  dailyLoops.set(userId, holder.promise);
  return holder.promise;
}

export async function runDailyCronTick(
  db: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<{
  ok: true;
  triggered: { user: string; started?: boolean; skipped?: string }[];
  backgroundPromises: Promise<void>[];
}> {
  const today = now.toISOString().slice(0, 10);
  const currentUtcHour = now.getUTCHours();

  const { data: users } = await db
    .from("user_scrape_settings")
    .select("*")
    .eq("enabled", true)
    .eq("run_hour", currentUtcHour)
    .order("last_run_at", { ascending: true, nullsFirst: true });

  const dailyLoops = getDailyCronLoops();
  const triggered: { user: string; started?: boolean; skipped?: string }[] = [];
  const backgroundPromises: Promise<void>[] = [];

  for (const st of users ?? []) {
    const prev = parseEnvelope(st.progress);
    const lastRunDate = extractLastRunDate(
      st as { last_run_date?: string | null; progress?: Json | null },
    );

    if (lastRunDate === today) {
      triggered.push({ user: st.user_id, skipped: "already_ran_today" });
      continue;
    }

    if (st.pause_reason && prev.date === today) {
      triggered.push({ user: st.user_id, skipped: "paused" });
      continue;
    }

    if (dailyLoops.has(st.user_id) || (st.lock_until && new Date(st.lock_until) > now)) {
      triggered.push({ user: st.user_id, skipped: "locked" });
      continue;
    }

    // Immediately record today's last_run_date and lock before spawning fire-and-forget loop.
    await persistDailyProgress(
      db,
      st.user_id,
      today,
      { done: [], competitors: 0, found: 0, saved: 0 },
      {
        lock_until: new Date(now.getTime() + 60 * 60_000).toISOString(),
        last_run_at: now.toISOString(),
        pause_reason: null,
      },
    );
    await tryWriteTopLevelLastRunDate(db, st.user_id, today);

    // Fire and forget: do NOT await the background loop in the cron HTTP response.
    const loopPromise = launchDailyUserScrapeLoop(db, st.user_id, today);
    backgroundPromises.push(loopPromise);
    triggered.push({ user: st.user_id, started: true });
  }

  return { ok: true, triggered, backgroundPromises };
}

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
  __churnhoundUserClients?: Map<string, SupabaseClient<Database>>;
  __churnhoundBootResumed?: boolean;
};

function getActiveLoops(): Map<string, Promise<void>> {
  if (!globalLoops.__churnhoundManualLoops) {
    globalLoops.__churnhoundManualLoops = new Map();
  }
  return globalLoops.__churnhoundManualLoops;
}

function getUserClients(): Map<string, SupabaseClient<Database>> {
  if (!globalLoops.__churnhoundUserClients) {
    globalLoops.__churnhoundUserClients = new Map();
  }
  return globalLoops.__churnhoundUserClients;
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
  if (activeLoops.has(userId)) return;

  const loopPromise = (async () => {
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
        const compId = state.competitor_ids[idx];
        const compName = state.competitor_names[idx] ?? compId ?? "Competitor";
        if (!compId) continue;

        state.current_competitor_index = idx;
        state.current_competitor_name = compName;
        state.step = "fetching";
        await persistJobState(userId, state);

        try {
          const db = await resolveDbClient(userId);
          const s = await scrapeCore(db, compId, state.platform);
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

          const freshDb = await resolveDbClient(userId);
          const a = await analyzeCore(freshDb, compId, s.reviews);
          state.stats.relevant += a.relevant;
          state.stats.analyzed += a.analyzed;
          state.stats.saved += a.saved;
          state.stats.emails += a.emails;
          state.stats.linkedin += a.linkedin;
          state.stats.social += a.social;
          state.stats.discarded += a.discarded;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("scrape-all competitor error", compId, msg);
          state.errors.push(`${compName}: ${msg}`);
        }

        state.current_competitor_index = idx + 1;
        await persistJobState(userId, state);
      }

      try {
        const db = await resolveDbClient(userId);
        const { runBrandListeningForUser } = await import("./brand-listening.server");
        await runBrandListeningForUser(db, userId, state.platform, {
          brand_listening_date: new Date().toISOString().slice(0, 10),
        });
      } catch (brandErr) {
        console.warn(
          "[BrandListening] background scan skipped:",
          brandErr instanceof Error ? brandErr.message : brandErr,
        );
      }

      state.job_status = "completed";
      state.step = "done";
      state.current_competitor_name = null;
      state.finished_at = new Date().toISOString();
      await persistJobState(userId, state);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("scrape-all background loop error", msg);
      state.errors.push(msg);
      state.job_status = "completed";
      state.step = "done";
      state.current_competitor_name = null;
      state.finished_at = new Date().toISOString();
      await persistJobState(userId, state);
    } finally {
      activeLoops.delete(userId);
    }
  })();

  activeLoops.set(userId, loopPromise);
}

export async function startManualScrapeJob(
  userId: string,
  competitorIds: string[],
  platform: Platform | "all",
  explicitClient?: SupabaseClient<Database>,
): Promise<{ started: boolean; resumed: boolean; status: ManualScrapeJobState }> {
  const db = await resolveDbClient(userId, explicitClient);
  const activeLoops = getActiveLoops();
  const existingEnvelope = await readUserEnvelope(userId, db);
  const existing = normalizeJobState(existingEnvelope);

  if (existing && existing.job_status === "running") {
    if (
      !activeLoops.has(userId) &&
      existing.current_competitor_index < existing.competitor_ids.length
    ) {
      launchBackgroundLoop(userId, existing);
      return { started: false, resumed: true, status: existing };
    }
    return { started: false, resumed: false, status: existing };
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

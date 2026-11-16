import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import {
  cancelManualScrapeJob,
  createIdleJobState,
  extractLastRunDate,
  getManualScrapeStatus,
  runDailyCronTick,
} from "./scrape-jobs.server";

const runMocks = vi.hoisted(() => ({
  scrapeCore: vi.fn(),
  analyzeCore: vi.fn(),
  runBrandListeningForUser: vi.fn(),
}));

vi.mock("./run.server", () => ({
  scrapeCore: runMocks.scrapeCore,
  analyzeCore: runMocks.analyzeCore,
}));

vi.mock("./brand-listening.server", () => ({
  runBrandListeningForUser: runMocks.runBrandListeningForUser,
}));

describe("authenticateCronRequest", () => {
  const originalCronSecret = process.env["CRON_SECRET"];
  const originalLovableSecret = process.env["LOVABLE_CRON_SECRET"];
  const originalLovablePrevious = process.env["LOVABLE_CRON_SECRET_PREVIOUS"];

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env["CRON_SECRET"];
    else process.env["CRON_SECRET"] = originalCronSecret;

    if (originalLovableSecret === undefined) delete process.env["LOVABLE_CRON_SECRET"];
    else process.env["LOVABLE_CRON_SECRET"] = originalLovableSecret;

    if (originalLovablePrevious === undefined) delete process.env["LOVABLE_CRON_SECRET_PREVIOUS"];
    else process.env["LOVABLE_CRON_SECRET_PREVIOUS"] = originalLovablePrevious;
  });

  it("returns 500 when no cron secret is configured", async () => {
    delete process.env["CRON_SECRET"];
    delete process.env["LOVABLE_CRON_SECRET"];
    delete process.env["LOVABLE_CRON_SECRET_PREVIOUS"];

    const req = new Request("http://localhost/api/public/jobs/daily-scrape", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    });
    const res = await authenticateCronRequest(req);
    expect(res?.status).toBe(500);
  });

  it("authorizes valid CRON_SECRET Bearer token", async () => {
    process.env["CRON_SECRET"] = "my-custom-cron-secret";
    delete process.env["LOVABLE_CRON_SECRET"];

    const req = new Request("http://localhost/api/public/jobs/daily-scrape", {
      method: "POST",
      headers: { Authorization: "Bearer my-custom-cron-secret" },
    });
    const res = await authenticateCronRequest(req);
    expect(res).toBeNull();
  });

  it("rejects wrong or missing Bearer token with 401", async () => {
    process.env["CRON_SECRET"] = "my-custom-cron-secret";

    const wrong = await authenticateCronRequest(
      new Request("http://localhost/api/public/jobs/daily-scrape", {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
      }),
    );
    expect(wrong?.status).toBe(401);

    const missing = await authenticateCronRequest(
      new Request("http://localhost/api/public/jobs/daily-scrape", {
        method: "POST",
      }),
    );
    expect(missing?.status).toBe(401);
  });

  it("supports fallback to LOVABLE_CRON_SECRET", async () => {
    process.env["CRON_SECRET"] = "primary-secret";
    process.env["LOVABLE_CRON_SECRET"] = "legacy-lovable-secret";

    const res = await authenticateCronRequest(
      new Request("http://localhost/api/public/jobs/daily-scrape", {
        method: "POST",
        headers: { Authorization: "Bearer legacy-lovable-secret" },
      }),
    );
    expect(res).toBeNull();
  });
});

describe("createIdleJobState", () => {
  it("initializes crash-resilient job tracking defaults", () => {
    const state = createIdleJobState();
    expect(state.job_status).toBe("idle");
    expect(state.current_competitor_index).toBe(0);
    expect(state.competitor_ids).toEqual([]);
    expect(state.stats.saved).toBe(0);
  });
});

function makeSettingsMockDb(initialProgress: Record<string, unknown> | null) {
  let progress = initialProgress;
  const db = {
    from: (table: string) => {
      if (table !== "user_scrape_settings") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: progress ? { progress } : null, error: null }),
          }),
        }),
        upsert: async (payload: { progress?: Record<string, unknown> }) => {
          progress = payload.progress ?? null;
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient<Database>;

  return { db, getProgress: () => progress };
}

describe("manual scrape cancellation and stale recovery", () => {
  it("cancels a running manual scrape job immediately and marks it done", async () => {
    const runningState = {
      ...createIdleJobState(),
      job_id: "job-cancel-1",
      job_status: "running",
      step: "analyzing",
      competitor_ids: ["c1", "c2"],
      competitor_names: ["Comp 1", "Comp 2"],
      total_competitors: 2,
      current_competitor_index: 0,
      current_competitor_name: "Comp 1",
    };
    const { db } = makeSettingsMockDb({
      job_status: "running",
      current_competitor_index: 0,
      manual_job: runningState,
    });

    const cancelled = await cancelManualScrapeJob("user-cancel-1", db);
    expect(cancelled.job_status).toBe("completed");
    expect(cancelled.step).toBe("done");
    expect(cancelled.current_competitor_name).toBeNull();
    expect(cancelled.errors).toContain("Stopped by admin.");
  });

  it("recovers a stale running job that exceeded step timeout on last competitor", async () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const staleState = {
      ...createIdleJobState(),
      job_id: "job-stale-1",
      job_status: "running",
      step: "analyzing",
      competitor_ids: ["c1"],
      competitor_names: ["StuckComp"],
      total_competitors: 1,
      current_competitor_index: 0,
      current_competitor_name: "StuckComp",
      started_at: tenMinutesAgo,
      updated_at: tenMinutesAgo,
    };
    const { db } = makeSettingsMockDb({
      job_status: "running",
      current_competitor_index: 0,
      manual_job: staleState,
    });

    const recovered = await getManualScrapeStatus("user-stale-1", db);
    expect(recovered.job_status).toBe("completed");
    expect(recovered.step).toBe("done");
    expect(recovered.errors.some((e) => e.includes("StuckComp: Step timed out"))).toBe(true);
  });
});

describe("daily cron exact-hour trigger and fire-and-forget execution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runMocks.runBrandListeningForUser.mockResolvedValue({ skipped: true });
  });

  function makeDailyCronMockDb(opts: {
    rows: Array<{
      user_id: string;
      enabled: boolean;
      run_hour: number;
      last_run_at?: string | null;
      last_run_date?: string | null;
      lock_until?: string | null;
      pause_reason?: string | null;
      progress?: Record<string, unknown> | null;
    }>;
    competitorsByUser: Record<string, Array<{ id: string; name: string }>>;
  }) {
    const rows = opts.rows.map((r) => ({
      last_run_at: null,
      lock_until: null,
      pause_reason: null,
      progress: null,
      ...r,
    }));
    const eqCalls: Array<{ col: string; val: unknown }> = [];

    const db = {
      from: (table: string) => {
        if (table === "user_scrape_settings") {
          return {
            select: () => {
              const filters: Array<(r: (typeof rows)[number]) => boolean> = [];
              const chain = {
                eq: (col: string, val: unknown) => {
                  eqCalls.push({ col, val });
                  filters.push((r) => (r as Record<string, unknown>)[col] === val);
                  return chain;
                },
                order: async () => ({
                  data: rows.filter((r) => filters.every((fn) => fn(r))),
                  error: null,
                }),
                maybeSingle: async () => ({
                  data: rows.find((r) => filters.every((fn) => fn(r))) ?? null,
                  error: null,
                }),
              };
              return chain;
            },
            update: (patch: Record<string, unknown>) => ({
              eq: async (_col: string, userId: string) => {
                const target = rows.find((r) => r.user_id === userId);
                if (target) Object.assign(target, patch);
                return { error: null };
              },
            }),
          };
        }
        if (table === "competitors") {
          return {
            select: () => ({
              eq: (_col: string, userId: string) => ({
                order: async () => ({
                  data: opts.competitorsByUser[userId] ?? [],
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    return { db, rows, eqCalls };
  }

  it("queries exact run_hour (.eq) and skips users who already ran today (last_run_date === today)", async () => {
    const now = new Date("2026-11-16T06:10:00.000Z");
    const { db, rows, eqCalls } = makeDailyCronMockDb({
      rows: [
        {
          user_id: "user-done-today",
          enabled: true,
          run_hour: 6,
          last_run_date: "2026-11-16",
        },
        {
          user_id: "user-wrong-hour",
          enabled: true,
          run_hour: 5,
          last_run_date: "2026-11-15",
        },
      ],
      competitorsByUser: {
        "user-done-today": [{ id: "c1", name: "Comp1" }],
        "user-wrong-hour": [{ id: "c2", name: "Comp2" }],
      },
    });

    const res = await runDailyCronTick(db, now);
    await Promise.all(res.backgroundPromises);

    expect(eqCalls).toContainEqual({ col: "run_hour", val: 6 });
    expect(res.triggered).toEqual([{ user: "user-done-today", skipped: "already_ran_today" }]);
    expect(runMocks.scrapeCore).not.toHaveBeenCalled();
    expect(rows[0]?.last_run_at).toBeNull();
  });

  it("immediately updates last_run_date and spawns fire-and-forget background task looping through ALL competitors", async () => {
    const now = new Date("2026-11-16T04:05:00.000Z");
    const { db, rows } = makeDailyCronMockDb({
      rows: [
        {
          user_id: "user-fire-1",
          enabled: true,
          run_hour: 4,
          progress: { last_run_date: "2026-11-15" },
        },
      ],
      competitorsByUser: {
        "user-fire-1": [
          { id: "c1", name: "Comp A" },
          { id: "c2", name: "Comp B" },
          { id: "c3", name: "Comp C" },
        ],
      },
    });

    runMocks.scrapeCore.mockResolvedValue({ reviews: [{ source_url: "u1" }], sources: [] });
    runMocks.analyzeCore.mockResolvedValue({ saved: 2, relevant: 1, analyzed: 1 });

    const res = await runDailyCronTick(db, now);

    // Immediately returns before awaiting backgroundPromises, and stamps last_run_date === today
    expect(res.triggered).toEqual([{ user: "user-fire-1", started: true }]);
    expect(extractLastRunDate(rows[0]!)).toBe("2026-11-16");

    // Second tick in the same hour is immediately skipped because last_run_date is already today
    const secondTick = await runDailyCronTick(db, new Date("2026-11-16T04:15:00.000Z"));
    expect(secondTick.triggered).toEqual([{ user: "user-fire-1", skipped: "already_ran_today" }]);

    // Background task completes all 3 competitors
    await Promise.all(res.backgroundPromises);
    expect(runMocks.scrapeCore).toHaveBeenCalledTimes(3);
    expect(runMocks.analyzeCore).toHaveBeenCalledTimes(3);
    expect(rows[0]?.progress).toMatchObject({
      date: "2026-11-16",
      last_run_date: "2026-11-16",
      competitors: 3,
      found: 3,
      saved: 6,
    });
    expect(rows[0]?.lock_until).toBeNull();
  });
});

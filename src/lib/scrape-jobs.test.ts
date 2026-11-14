import { afterEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import {
  cancelManualScrapeJob,
  createIdleJobState,
  getManualScrapeStatus,
} from "./scrape-jobs.server";

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

import { afterEach, describe, expect, it } from "vitest";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { createIdleJobState } from "./scrape-jobs.server";

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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runBrandListeningForUser } from "./brand-listening.server";

const mocks = vi.hoisted(() => ({
  scrapePlatform: vi.fn(),
  geminiJson: vi.fn(),
}));

vi.mock("./scrapers.server", () => ({
  scrapePlatform: mocks.scrapePlatform,
}));

vi.mock("./ai.server", () => ({
  geminiJson: mocks.geminiJson,
}));

function makeMockDb(opts: { email: string; hasCompleted: boolean }) {
  const insertedBrandMentions: Record<string, unknown>[] = [];
  const profileUpdates: Record<string, unknown>[] = [];
  const leadsTouched = vi.fn();

  const db = {
    from: (table: string) => {
      if (table === "leads") {
        leadsTouched();
        throw new Error("Brand listening must never touch leads table");
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  email: opts.email,
                  company_name: "Churnhound",
                  company_url: "https://churnhound.io",
                  has_completed_brand_baseline: opts.hasCompleted,
                },
                error: null,
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            profileUpdates.push(payload);
            return {
              eq: async () => ({ error: null }),
            };
          },
        };
      }
      if (table === "user_scrape_settings") {
        let currentProgress: Record<string, unknown> | null = null;
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: currentProgress ? { progress: currentProgress } : null,
                error: null,
              }),
            }),
          }),
          upsert: async (payload: { progress?: Record<string, unknown> }) => {
            currentProgress = payload.progress ?? null;
            return { error: null };
          },
        };
      }
      if (table === "brand_mentions") {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: insertedBrandMentions.map((r, i) => ({
                    id: `bm-${i}`,
                    created_at: r["created_at"] ?? new Date().toISOString(),
                    ...r,
                  })),
                  error: null,
                }),
              }),
              then: (cb: (v: { data: { post_url: string }[]; error: null }) => void) =>
                cb({
                  data: insertedBrandMentions.map((r) => ({ post_url: String(r["post_url"]) })),
                  error: null,
                }),
            }),
          }),
          insert: async (rows: Record<string, unknown>[]) => {
            insertedBrandMentions.push(...rows);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return { db, insertedBrandMentions, profileUpdates, leadsTouched };
}

describe("runBrandListeningForUser baseline & 48h exception", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs comprehensive historical baseline when has_completed_brand_baseline is false for regular user", async () => {
    const oldPost = {
      platform: "reddit" as const,
      reviewer_name: "old_user",
      reviewer_profile_url: "https://reddit.com/u/old_user",
      source_url: "https://reddit.com/r/saas/historical-1",
      text: "Been using Churnhound since 2025, love the alerts.",
      published_at: "2025-03-01T10:00:00Z",
    };

    mocks.scrapePlatform.mockImplementation(async (_ctx, platform) =>
      platform === "reddit"
        ? { status: "ok", reviews: [oldPost] }
        : { status: "no_match", reviews: [] },
    );
    mocks.geminiJson.mockResolvedValue({
      results: [
        {
          index: 0,
          relevant: true,
          sentiment_score: 8,
          sentiment: "positive",
          extracted_complaint: "",
          summary: "Praises Churnhound alerts.",
        },
      ],
    });

    const { db, insertedBrandMentions, profileUpdates, leadsTouched } = makeMockDb({
      email: "govindpanicker666@gmail.com",
      hasCompleted: false,
    });

    const res = await runBrandListeningForUser(db, "user-1", "reddit");
    expect(res.apply48HourFilter).toBe(false);
    expect(mocks.scrapePlatform).toHaveBeenCalledWith(
      { name: "Churnhound", domain: "churnhound.io" },
      "reddit",
      { apply48HourFilter: false },
    );
    expect(insertedBrandMentions).toHaveLength(1);
    expect(insertedBrandMentions[0]?.["post_url"]).toBe("https://reddit.com/r/saas/historical-1");
    expect(profileUpdates).toContainEqual({ has_completed_brand_baseline: true });
    expect(leadsTouched).not.toHaveBeenCalled();
  });

  it("forces 48-hour filter on first run for exception user boosted688@gmail.com and still marks baseline complete", async () => {
    const oldPost = {
      platform: "reddit" as const,
      reviewer_name: "old_user",
      reviewer_profile_url: "https://reddit.com/u/old_user",
      source_url: "https://reddit.com/r/saas/historical-2",
      text: "Old post from last year about Churnhound.",
      published_at: "2025-03-01T10:00:00Z",
    };
    const recentPost = {
      platform: "reddit" as const,
      reviewer_name: "recent_user",
      reviewer_profile_url: "https://reddit.com/u/recent_user",
      source_url: "https://reddit.com/r/saas/recent-1",
      text: "Churnhound pricing page confused me today.",
      published_at: new Date().toISOString(),
    };

    mocks.scrapePlatform.mockResolvedValue({ status: "ok", reviews: [oldPost, recentPost] });
    mocks.geminiJson.mockResolvedValue({
      results: [
        {
          index: 0,
          relevant: true,
          sentiment_score: -5,
          sentiment: "negative",
          extracted_complaint: "Confusing pricing page",
          summary: "Author found pricing unclear.",
        },
      ],
    });

    const { db, insertedBrandMentions, profileUpdates, leadsTouched } = makeMockDb({
      email: "boosted688@gmail.com",
      hasCompleted: false,
    });

    const res = await runBrandListeningForUser(db, "user-2", "reddit");
    expect(res.apply48HourFilter).toBe(true);
    expect(mocks.scrapePlatform).toHaveBeenCalledWith(
      { name: "Churnhound", domain: "churnhound.io" },
      "reddit",
      { apply48HourFilter: true },
    );
    expect(insertedBrandMentions).toHaveLength(1);
    expect(insertedBrandMentions[0]?.["post_url"]).toBe("https://reddit.com/r/saas/recent-1");
    expect(profileUpdates).toContainEqual({ has_completed_brand_baseline: true });
    expect(leadsTouched).not.toHaveBeenCalled();
  });
});

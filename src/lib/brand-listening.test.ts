import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  generateAIBrandBaseline,
  generateAIBrandBaselineForUser,
  readBrandListeningState,
  readCompanyProfile,
  runBrandListeningForUser,
  saveCompanyProfileToDb,
} from "./brand-listening.server";

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

function makeMockDb(opts: {
  email: string;
  hasCompleted: boolean;
  companyName?: string | null;
  companyUrl?: string | null;
  initialMentions?: Record<string, unknown>[];
  initialProgress?: Record<string, unknown> | null;
  missingAiTable?: boolean;
}) {
  const insertedBrandMentions: Record<string, unknown>[] = [...(opts.initialMentions ?? [])];
  const profileUpdates: Record<string, unknown>[] = [];
  const leadsTouched = vi.fn();
  let aiInsightsRow: Record<string, unknown> | null = null;
  let currentProgress: Record<string, unknown> | null = opts.initialProgress ?? null;

  let profileRow = {
    email: opts.email,
    company_name: (opts.companyName !== undefined ? opts.companyName : "Churnhound") as
      string | null,
    company_url: (opts.companyUrl !== undefined ? opts.companyUrl : "https://churnhound.io") as
      string | null,
    has_completed_brand_baseline: opts.hasCompleted,
  };

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
                data: { ...profileRow },
                error: null,
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            profileUpdates.push(payload);
            profileRow = { ...profileRow, ...payload };
            return {
              eq: () =>
                Object.assign(Promise.resolve({ error: null }), {
                  select: async () => ({ data: [{ id: "user-1" }], error: null }),
                }),
            };
          },
          upsert: async (payload: Record<string, unknown>) => {
            profileUpdates.push(payload);
            profileRow = { ...profileRow, ...payload };
            return { error: null };
          },
        };
      }
      if (table === "competitors") {
        return {
          select: () => ({
            eq: () => ({
              limit: async () => ({
                data: [{ name: "Intercom" }, { name: "Zendesk" }],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "ai_brand_insights") {
        if (opts.missingAiTable) {
          const err = { code: "PGRST205", message: "Could not find the table" };
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: err }),
              }),
            }),
            upsert: async () => ({ error: err }),
            delete: () => ({
              eq: async () => ({ error: err }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: aiInsightsRow, error: null }),
            }),
          }),
          upsert: async (payload: Record<string, unknown>) => {
            aiInsightsRow = payload;
            return { error: null };
          },
          delete: () => ({
            eq: async () => {
              aiInsightsRow = null;
              return { error: null };
            },
          }),
        };
      }
      if (table === "user_scrape_settings") {
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
          select: (_cols?: string, selectOpts?: { count?: string; head?: boolean }) => ({
            eq: () => {
              if (selectOpts?.head) {
                return Promise.resolve({
                  count: insertedBrandMentions.length,
                  data: null,
                  error: null,
                });
              }
              return {
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
              };
            },
          }),
          insert: async (rows: Record<string, unknown>[]) => {
            insertedBrandMentions.push(...rows);
            return { error: null };
          },
          delete: () => ({
            eq: async () => {
              insertedBrandMentions.length = 0;
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return {
    db,
    insertedBrandMentions,
    profileUpdates,
    leadsTouched,
    getAiInsightsRow: () => aiInsightsRow,
    getProgress: () => currentProgress,
  };
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
      positive_hypotheses: ["Great alerts", "Easy setup", "Fast onboarding"],
      negative_hypotheses: ["Pricing tiers", "Mobile UI", "Limited exports"],
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
      positive_hypotheses: ["Great alerts", "Easy setup", "Fast onboarding"],
      negative_hypotheses: ["Pricing tiers", "Mobile UI", "Limited exports"],
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

describe("generateAIBrandBaseline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates and saves 3 positive and 3 negative hypotheses when brand_mentions < 3", async () => {
    mocks.geminiJson.mockResolvedValue({
      positive_hypotheses: [
        "Customers praise quick setup.",
        "Teams love real-time lead alerts.",
        "Founders appreciate clear sentiment scoring.",
      ],
      negative_hypotheses: [
        "Smaller teams want a lower starter tier.",
        "Users ask for deeper CRM integrations.",
        "Onboarding docs could be more detailed.",
      ],
    });

    const { db, getAiInsightsRow } = makeMockDb({
      email: "founder@churnhound.io",
      hasCompleted: true,
      initialMentions: [{ post_url: "https://example.com/1" }],
    });

    const res = await generateAIBrandBaseline(
      db,
      "user-ai-1",
      "Churnhound",
      "https://churnhound.io",
      ["Intercom", "Zendesk"],
    );

    expect(res.mentionCount).toBe(1);
    expect(res.insights?.positive_hypotheses).toHaveLength(3);
    expect(res.insights?.negative_hypotheses).toHaveLength(3);
    expect(getAiInsightsRow()?.["user_id"]).toBe("user-ai-1");
    expect(mocks.geminiJson).toHaveBeenCalledTimes(1);
  });

  it("skips Gemini generation when brand_mentions >= 3", async () => {
    const { db } = makeMockDb({
      email: "founder@churnhound.io",
      hasCompleted: true,
      initialMentions: [
        { post_url: "https://example.com/1" },
        { post_url: "https://example.com/2" },
        { post_url: "https://example.com/3" },
      ],
    });

    const res = await generateAIBrandBaseline(
      db,
      "user-ai-2",
      "Churnhound",
      "https://churnhound.io",
      ["Intercom"],
    );

    expect(res.mentionCount).toBe(3);
    expect(res.skippedReason).toBe("enough_mentions");
    expect(mocks.geminiJson).not.toHaveBeenCalled();
  });

  it("falls back to progress metadata cache when ai_brand_insights table is not yet created", async () => {
    mocks.geminiJson.mockResolvedValue({
      positive_hypotheses: ["P1", "P2", "P3"],
      negative_hypotheses: ["N1", "N2", "N3"],
    });

    const { db, getProgress } = makeMockDb({
      email: "founder@churnhound.io",
      hasCompleted: true,
      missingAiTable: true,
    });

    const res = await generateAIBrandBaseline(
      db,
      "user-ai-3",
      "Churnhound",
      "https://churnhound.io",
      [],
    );

    expect(res.insights?.positive_hypotheses).toEqual(["P1", "P2", "P3"]);
    const savedBlob = (getProgress()?.["brand_listening"] as Record<string, unknown> | undefined)?.[
      "ai_brand_insights"
    ];
    expect(savedBlob).toBeTruthy();
  });
});

describe("saveCompanyProfileToDb & readCompanyProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves company_name and company_url and preserves brand name when detectCompetitors omits name", async () => {
    const { db, profileUpdates, getProgress } = makeMockDb({
      email: "founder@churnhound.io",
      hasCompleted: false,
    });

    const saved = await saveCompanyProfileToDb(db, "user-p1", {
      company_name: "Churnhound",
      company_url: "https://churnhound.io",
      preserveEmptyName: false,
    });
    expect(saved).toEqual({
      company_name: "Churnhound",
      company_url: "https://churnhound.io",
    });

    const preserved = await saveCompanyProfileToDb(db, "user-p1", {
      company_name: null,
      company_url: "https://churnhound.io",
      preserveEmptyName: true,
    });
    expect(preserved).toEqual({
      company_name: "Churnhound",
      company_url: "https://churnhound.io",
    });
    expect(profileUpdates).toContainEqual({
      company_name: "Churnhound",
      company_url: "https://churnhound.io",
    });

    const blob = getProgress()?.["brand_listening"] as Record<string, unknown> | undefined;
    expect(blob?.["company_name"]).toBe("Churnhound");

    const loaded = await readCompanyProfile(db, "user-p1");
    expect(loaded.company_name).toBe("Churnhound");
    expect(loaded.company_url).toBe("https://churnhound.io");
  });

  it("clears previous brand mentions/insights and resets baseline flag when user switches to a new brand", async () => {
    const { db, insertedBrandMentions, profileUpdates, getAiInsightsRow, getProgress } = makeMockDb(
      {
        email: "founder@churnhound.io",
        hasCompleted: true,
        initialMentions: [
          {
            platform: "reddit",
            reviewer_name: "old_reviewer",
            review_text: "Old brand mention",
            sentiment_score: 5,
            extracted_complaint: null,
            post_url: "https://reddit.com/r/old/1",
          },
        ],
      },
    );

    // Seed an existing AI insight row for the old brand
    await db.from("ai_brand_insights").upsert({
      user_id: "user-p2",
      positive_hypotheses: ["Old P1"],
      negative_hypotheses: ["Old N1"],
      generated_at: "2026-01-01T00:00:00.000Z",
    });

    const switched = await saveCompanyProfileToDb(db, "user-p2", {
      company_name: "AcmeNew",
      company_url: "https://acmenew.io",
      preserveEmptyName: false,
    });

    expect(switched).toEqual({
      company_name: "AcmeNew",
      company_url: "https://acmenew.io",
    });
    expect(insertedBrandMentions).toHaveLength(0);
    expect(getAiInsightsRow()).toBeNull();
    expect(profileUpdates.at(-1)).toMatchObject({
      company_name: "AcmeNew",
      company_url: "https://acmenew.io",
      has_completed_brand_baseline: false,
    });

    const blob = getProgress()?.["brand_listening"] as Record<string, unknown> | undefined;
    expect(blob?.["company_name"]).toBe("AcmeNew");
    expect(blob?.["has_completed_brand_baseline"]).toBe(false);
    expect(blob?.["mentions"]).toEqual([]);
    expect(blob?.["ai_brand_insights"]).toBeNull();
  });

  it("purges legacy unlabelled Taplio mentions & AI insights when profiles already points to Hunter", async () => {
    const { db, insertedBrandMentions, getAiInsightsRow, getProgress } = makeMockDb({
      email: "govindpanicker666@gmail.com",
      hasCompleted: true,
      companyName: "Hunter",
      companyUrl: "https://hunter.io",
      initialMentions: [
        {
          platform: "reddit",
          reviewer_name: "taplio_fan",
          review_text: "Taplio scheduling is great for LinkedIn posts.",
          sentiment_score: 7,
          extracted_complaint: null,
          post_url: "https://reddit.com/r/saas/taplio-1",
        },
      ],
    });

    await db.from("ai_brand_insights").upsert({
      user_id: "user-legacy-1",
      positive_hypotheses: ["Taplio is fast for LinkedIn carousels"],
      negative_hypotheses: ["Taplio pricing is high"],
      generated_at: "2026-01-01T00:00:00.000Z",
    });

    const state = await readBrandListeningState(db, "user-legacy-1");
    expect(state.company_name).toBe("Hunter");
    expect(state.company_url).toBe("https://hunter.io");
    expect(state.mentions).toEqual([]);
    expect(state.ai_brand_insights).toBeNull();
    expect(state.has_completed_brand_baseline).toBe(false);
    expect(insertedBrandMentions).toHaveLength(0);
    expect(getAiInsightsRow()).toBeNull();

    const blob = getProgress()?.["brand_listening"] as Record<string, unknown> | undefined;
    expect(blob?.["mentions_brand_key"]).toBe("hunter|hunter.io");
    expect(blob?.["insights_brand_key"]).toBeNull();
  });

  it("drops legacy unlabelled Taplio AI insights (0 mentions) and regenerates fresh insights for Hunter", async () => {
    mocks.geminiJson.mockResolvedValue({
      positive_hypotheses: [
        "Hunter finds verified B2B emails quickly.",
        "Teams love Hunter domain search accuracy.",
        "Campaign outreach workflows feel simple.",
      ],
      negative_hypotheses: [
        "Credit limits can feel tight on smaller plans.",
        "Niche local businesses have fewer matches.",
        "Users want deeper CRM sync options.",
      ],
    });

    const { db, getAiInsightsRow, getProgress } = makeMockDb({
      email: "govindpanicker666@gmail.com",
      hasCompleted: true,
      companyName: "Hunter",
      companyUrl: "https://hunter.io",
      initialMentions: [],
    });

    await db.from("ai_brand_insights").upsert({
      user_id: "user-legacy-2",
      positive_hypotheses: ["Taplio boosts LinkedIn reach"],
      negative_hypotheses: ["Taplio feels expensive"],
      generated_at: "2026-01-01T00:00:00.000Z",
    });

    const initialState = await readBrandListeningState(db, "user-legacy-2");
    expect(initialState.company_name).toBe("Hunter");
    expect(initialState.ai_brand_insights).toBeNull();
    expect(getAiInsightsRow()).toBeNull();

    const generated = await generateAIBrandBaselineForUser(db, "user-legacy-2");
    expect(generated.insights?.positive_hypotheses[0]).toContain("Hunter");
    expect(mocks.geminiJson).toHaveBeenCalledTimes(1);

    const blob = getProgress()?.["brand_listening"] as Record<string, unknown> | undefined;
    expect(blob?.["insights_brand_key"]).toBe("hunter|hunter.io");

    const nextState = await readBrandListeningState(db, "user-legacy-2");
    expect(nextState.ai_brand_insights?.positive_hypotheses[0]).toContain("Hunter");
  });
});

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { analyzeCore, scrapeCore } from "./run.server";
import { PLATFORMS } from "./pipeline";

const mocks = vi.hoisted(() => ({
  geminiJson: vi.fn(),
  findContact: vi.fn(),
  scrapePlatform: vi.fn(),
}));
vi.mock("./ai.server", () => ({ geminiJson: mocks.geminiJson }));
vi.mock("./enrich.server", () => ({ findContact: mocks.findContact }));
vi.mock("./scrapers.server", () => ({ scrapePlatform: mocks.scrapePlatform }));

describe("negative-only lead analysis", () => {
  it("does not save a normal company mention even if AI assigns score 1", async () => {
    mocks.geminiJson.mockResolvedValue({
      results: [
        {
          index: 0,
          relevant: true,
          score: 1,
          sentiment: "neutral",
          negative_quote: "",
          complaint: "",
          is_person: true,
        },
      ],
    });
    mocks.findContact.mockResolvedValue({ email: null, linkedin: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "c",
                user_id: "u",
                name: "CapCut",
                url: "https://capcut.com",
                keywords: [],
              },
            }),
          }),
        }),
        upsert,
      }),
    } as unknown as SupabaseClient<Database>;
    const result = await analyzeCore(client, "c", [
      {
        platform: "bluesky",
        reviewer_name: "Jane Doe",
        reviewer_profile_url: null,
        source_url: "https://bsky.app/post/1",
        text: "Made on CapCut AI Template yesterday.",
        published_at: new Date().toISOString(),
      },
    ]);
    expect(result.saved).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("saves negative Threads post as social_signal with source_url preserved", async () => {
    mocks.geminiJson.mockResolvedValue({
      results: [
        {
          index: 0,
          relevant: true,
          score: 7,
          sentiment: "negative",
          negative_quote: "way too expensive",
          complaint: "High pricing",
          pitch: "Try a simpler alternative.",
          job_title: null,
          company: null,
          is_person: true,
        },
      ],
    });
    mocks.findContact.mockResolvedValue({
      email: null,
      emailStatus: null,
      linkedin: null,
      jobTitle: null,
      company: null,
      companyDomain: null,
      name: "aismr.ka",
    });

    let upsertedRows: Record<string, unknown>[] = [];
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "c",
                user_id: "u",
                name: "Mixpanel",
                url: "https://mixpanel.com",
                domain: "mixpanel.com",
                keywords: [],
              },
            }),
            then: (cb: (v: { data: unknown[]; error: null }) => void) =>
              cb({ data: [], error: null }),
          }),
        }),
        upsert: (rows: Record<string, unknown>[]) => {
          upsertedRows = rows;
          return {
            select: async () => ({ data: rows.map((_, i) => ({ id: String(i) })), error: null }),
          };
        },
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await analyzeCore(client, "c", [
      {
        platform: "threads",
        reviewer_name: "aismr.ka",
        reviewer_profile_url: "https://www.threads.net/@aismr.ka",
        source_url: "https://www.threads.net/@aismr.ka/post/DdgaiIbCKMt",
        text: "Mixpanel is way too expensive for small startups.",
        published_at: new Date().toISOString(),
      },
    ]);

    expect(result.saved).toBe(1);
    expect(result.social).toBe(1);
    expect(upsertedRows[0]).toMatchObject({
      source_platform: "threads",
      source_url: "https://www.threads.net/@aismr.ka/post/DdgaiIbCKMt",
      reviewer_profile_url: "https://www.threads.net/@aismr.ka",
      lead_type: "social_signal",
      linkedin_url: null,
    });
  });

  it("chunks >20 reviews cleanly and handles direct array / string-typed AI responses", async () => {
    mocks.geminiJson.mockReset();
    mocks.findContact.mockResolvedValue({
      email: null,
      emailStatus: null,
      linkedin: null,
      jobTitle: null,
      company: null,
      companyDomain: null,
      name: "User",
    });

    // First chunk returns 20 items wrapped as direct array with stringified index/relevant/score;
    // second chunk returns 5 items where item 2 (global index 22) is negative.
    mocks.geminiJson
      .mockResolvedValueOnce(
        Array.from({ length: 20 }, (_, i) => ({
          index: String(i),
          relevant: i === 0 ? "true" : false,
          score: "0",
          sentiment: "neutral",
          negative_quote: "",
          complaint: "",
          pitch: "",
          job_title: null,
          company: null,
          is_person: true,
        })),
      )
      .mockResolvedValueOnce({
        results: Array.from({ length: 5 }, (_, i) => ({
          index: i,
          relevant: i === 2,
          score: i === 2 ? 8 : 0,
          sentiment: i === 2 ? "negative" : "neutral",
          negative_quote: i === 2 ? "pricing doubled overnight" : "",
          complaint: i === 2 ? "Sudden price hike" : "",
          pitch: i === 2 ? "Switch to predictable pricing." : "",
          job_title: null,
          company: null,
          is_person: true,
        })),
      });

    let upsertedRows: Record<string, unknown>[] = [];
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "c",
                user_id: "u",
                name: "HubSpot",
                url: "https://hubspot.com",
                domain: "hubspot.com",
                keywords: [],
              },
            }),
            then: (cb: (v: { data: unknown[]; error: null }) => void) =>
              cb({ data: [], error: null }),
          }),
        }),
        upsert: (rows: Record<string, unknown>[]) => {
          upsertedRows = rows;
          return {
            select: async () => ({ data: rows.map((_, i) => ({ id: String(i) })), error: null }),
          };
        },
      }),
    } as unknown as SupabaseClient<Database>;

    const reviews = Array.from({ length: 25 }, (_, i) => ({
      platform: "linkedin" as const,
      reviewer_name: `User ${i}`,
      reviewer_profile_url: null,
      source_url: `https://www.linkedin.com/posts/user-${i}_hubspot-activity-${i}`,
      text:
        i === 22
          ? "HubSpot pricing doubled overnight and our team is looking for alternatives."
          : `Discussion post #${i} mentioning HubSpot.`,
      published_at: new Date().toISOString(),
    }));

    const result = await analyzeCore(client, "c", reviews);
    expect(mocks.geminiJson).toHaveBeenCalledTimes(2);
    expect(result.analyzed).toBe(25);
    expect(result.relevant).toBe(2);
    expect(result.saved).toBe(1);
    expect(upsertedRows[0]?.["source_url"]).toBe(
      "https://www.linkedin.com/posts/user-22_hubspot-activity-22",
    );
  });


  it("analyzes and saves more than 60 negative reviews and more than 15 leads", async () => {
    mocks.geminiJson.mockReset();
    mocks.geminiJson.mockImplementation(async (_system: unknown, prompt: unknown) => {
      const indices = [...String(prompt).matchAll(/^\[(\d+)\] \(/gm)].map((match) =>
        Number(match[1]),
      );
      return {
        results: indices.map((index) => ({
          index,
          relevant: true,
          score: 6,
          sentiment: "negative",
          negative_quote: "painfully slow and keeps failing",
          complaint: "slow support",
          pitch: "Try a more reliable option.",
          job_title: null,
          company: null,
          is_person: true,
        })),
      };
    });
    mocks.findContact.mockResolvedValue({
      email: null,
      emailStatus: null,
      linkedin: null,
      jobTitle: null,
      company: null,
      companyDomain: null,
      name: "Verified User",
    });

    let upsertedRows: Record<string, unknown>[] = [];
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "c",
                user_id: "u",
                name: "HubSpot",
                url: "https://hubspot.com",
                domain: "hubspot.com",
                keywords: [],
              },
            }),
            then: (cb: (v: { data: unknown[]; error: null }) => void) =>
              cb({ data: [], error: null }),
          }),
        }),
        upsert: (rows: Record<string, unknown>[]) => {
          upsertedRows = rows;
          return {
            select: async () => ({ data: rows.map((_, i) => ({ id: String(i) })), error: null }),
          };
        },
      }),
    } as unknown as SupabaseClient<Database>;

    const reviews = Array.from({ length: 70 }, (_, i) => ({
      platform: "g2" as const,
      reviewer_name: "Verified User",
      reviewer_profile_url: null,
      source_url: `https://www.g2.com/products/hubspot/reviews/review-${i}`,
      text: `HubSpot support is painfully slow and keeps failing for this customer ticket ${i}.`,
      published_at: new Date().toISOString(),
    }));

    const result = await analyzeCore(client, "c", reviews);
    expect(mocks.geminiJson).toHaveBeenCalledTimes(4);
    expect(result.analyzed).toBe(70);
    expect(result.relevant).toBe(70);
    expect(result.saved).toBe(70);
    expect(result.social).toBe(70);
    expect(upsertedRows).toHaveLength(70);
    expect(upsertedRows[0]).toMatchObject({
      source_platform: "g2",
      lead_type: "social_signal",
      email: null,
      linkedin_url: null,
    });
  });

  it("does not truncate all-platform scraping at 60 total posts", async () => {
    mocks.scrapePlatform.mockImplementation(async (_ctx: unknown, platform: string) => ({
      status: "ok",
      reviews: Array.from({ length: 2 }, (_, i) => ({
        platform,
        reviewer_name: `Reviewer ${i}`,
        reviewer_profile_url: null,
        source_url: `https://example.com/${platform}/${i}`,
        text: `Complaint about product ${i}`,
        published_at: new Date().toISOString(),
      })),
    }));
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "c",
                name: "HubSpot",
                url: "https://hubspot.com",
                domain: "hubspot.com",
              },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await scrapeCore(client, "c", "all");
    expect(result.reviews).toHaveLength(PLATFORMS.length * 2);
    expect(result.reviews.length).toBeGreaterThan(60);
  });

  it("surfaces clear AI_CONFIG diagnostic when GEMINI_API_KEY is missing", async () => {
    mocks.geminiJson.mockReset();
    mocks.geminiJson.mockRejectedValue(new Error("GEMINI_API_KEY is not set"));

    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "c",
                user_id: "u",
                name: "HubSpot",
                url: "https://hubspot.com",
                domain: "hubspot.com",
                keywords: [],
              },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient<Database>;

    await expect(
      analyzeCore(client, "c", [
        {
          platform: "x",
          reviewer_name: "@user1",
          reviewer_profile_url: null,
          source_url: "https://x.com/user1/status/1",
          text: "HubSpot is frustrating.",
          published_at: new Date().toISOString(),
        },
      ]),
    ).rejects.toThrow(/AI_CONFIG: GEMINI_API_KEY is not set/);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORMS } from "./pipeline";
import { scrapeJirosearch, scrapePlatform } from "./scrapers.server";

describe("scrapeJirosearch and social platform routing", () => {
  const originalJiroKey = process.env["JIROSEARCH_API_KEY"];
  const originalTrueKey = process.env["TRUESCRAPE_API_KEY"];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalJiroKey === undefined) {
      delete process.env["JIROSEARCH_API_KEY"];
    } else {
      process.env["JIROSEARCH_API_KEY"] = originalJiroKey;
    }
    if (originalTrueKey === undefined) {
      delete process.env["TRUESCRAPE_API_KEY"];
    } else {
      process.env["TRUESCRAPE_API_KEY"] = originalTrueKey;
    }
  });

  it("includes all Jirosearch social platforms in PLATFORMS", () => {
    for (const id of [
      "instagram",
      "linkedin",
      "x",
      "youtube",
      "tiktok",
      "facebook",
      "telegram",
      "pinterest",
    ] as const) {
      expect(PLATFORMS.some((p) => p.id === id)).toBe(true);
    }
  });

  it("returns no_key status when both JIROSEARCH_API_KEY and fallback key are unset", async () => {
    delete process.env["JIROSEARCH_API_KEY"];
    delete process.env["TRUESCRAPE_API_KEY"];
    const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "instagram");
    expect(res).toEqual({ status: "no_key", reviews: [] });
  });

  it("calls Jirosearch API and maps items to RawReview across instagram, linkedin, x, and youtube", async () => {
    process.env["JIROSEARCH_API_KEY"] = "test-jiro-key";
    const nowIso = new Date().toISOString();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              source: "instagram",
              title: "Support frustration",
              body: "Acme support took days to reply.",
              reviewerName: "@insta_user",
              reviewedAt: nowIso,
              sourceUrl: "https://www.instagram.com/p/abc123/",
            },
            {
              source: "twitter",
              text: "Switched away from Acme after the price hike.",
              url: "https://x.com/jane_founder/status/123456",
              createdAt: nowIso,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reviews = await scrapeJirosearch("Acme", ["instagram", "linkedin", "x", "youtube"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.jirosearch.com/v1/search",
      expect.objectContaining({
        method: "POST",
      }),
    );

    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toEqual({
      platform: "instagram",
      reviewer_name: "@insta_user",
      reviewer_profile_url: null,
      source_url: "https://www.instagram.com/p/abc123/",
      text: "Support frustration. Acme support took days to reply.",
      published_at: nowIso,
    });
    expect(reviews[1]).toEqual({
      platform: "x",
      reviewer_name: "@jane_founder",
      reviewer_profile_url: null,
      source_url: "https://x.com/jane_founder/status/123456",
      text: "Switched away from Acme after the price hike.",
      published_at: nowIso,
    });
  });

  it("routes all Jirosearch platforms cleanly in scrapePlatform", async () => {
    process.env["JIROSEARCH_API_KEY"] = "test-jiro-key";
    const nowIso = new Date().toISOString();

    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const parsed = JSON.parse(String(init?.body ?? "{}")) as { platforms?: string[] };
      const target = parsed.platforms?.[0] ?? "x";
      return new Response(
        JSON.stringify({
          results: [
            {
              source: target,
              body: `Review on ${target} about Acme.`,
              reviewerName: "Alex Rivera",
              reviewedAt: nowIso,
              sourceUrl: `https://example.com/${target}/post-1`,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    for (const p of [
      "x",
      "youtube",
      "linkedin",
      "instagram",
      "tiktok",
      "facebook",
      "telegram",
      "pinterest",
    ] as const) {
      const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, p);
      expect(res.status).toBe("ok");
      expect(res.reviews).toHaveLength(1);
      expect(res.reviews[0]?.platform).toBe(p);
    }
  });
});

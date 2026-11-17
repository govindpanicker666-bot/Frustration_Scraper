import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORMS } from "./pipeline";
import { scrapeJirosearch, scrapePlatform } from "./scrapers.server";

describe("scrapeJirosearch and social platform routing", () => {
  const originalJiroUrl = process.env["JIRO_SEARCH_URL"];
  const originalLegacyUrl = process.env["JIROSEARCH_API_URL"];
  const originalJiroKey = process.env["JIROSEARCH_API_KEY"];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (originalJiroUrl === undefined) {
      delete process.env["JIRO_SEARCH_URL"];
    } else {
      process.env["JIRO_SEARCH_URL"] = originalJiroUrl;
    }
    if (originalLegacyUrl === undefined) {
      delete process.env["JIROSEARCH_API_URL"];
    } else {
      process.env["JIROSEARCH_API_URL"] = originalLegacyUrl;
    }
    if (originalJiroKey === undefined) {
      delete process.env["JIROSEARCH_API_KEY"];
    } else {
      process.env["JIROSEARCH_API_KEY"] = originalJiroKey;
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

  it("returns no_key status when JIRO_SEARCH_URL and legacy Jirosearch config are unset", async () => {
    delete process.env["JIRO_SEARCH_URL"];
    delete process.env["JIROSEARCH_API_URL"];
    delete process.env["JIROSEARCH_API_KEY"];
    const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "instagram");
    expect(res).toEqual({ status: "no_key", reviews: [] });
  });

  it("calls JIRO_SEARCH_URL/social/search with { query, platforms } and maps items to RawReview across x, instagram, facebook, pinterest, linkedin, tiktok", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    delete process.env["JIROSEARCH_API_KEY"];
    const nowIso = new Date().toISOString();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              source: "instagram",
              productIdentifier: "acme",
              reviewId: "rev-1",
              rating: 1,
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

    const reviews = await scrapeJirosearch("Acme", [
      "x",
      "instagram",
      "facebook",
      "pinterest",
      "linkedin",
      "tiktok",
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://jiro-search-api-xyz.onrender.com/social/search",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          query: "Acme",
          platforms: ["x", "instagram", "facebook", "pinterest", "linkedin", "tiktok"],
        }),
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

  it("flattens platform-grouped /social/search results cleanly", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    const nowIso = new Date().toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: {
            linkedin: [
              {
                text: "Acme keeps dropping connections.",
                author_name: "Sam Lee",
                posted_at: nowIso,
                post_url: "https://www.linkedin.com/posts/sam-lee-1",
              },
            ],
            x: [
              {
                content: "Migrating off Acme today.",
                username: "@dev_maya",
                created_at: nowIso,
                url: "https://x.com/dev_maya/status/999",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const reviews = await scrapeJirosearch("Acme", ["linkedin", "x"]);
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toMatchObject({
      platform: "linkedin",
      reviewer_name: "Sam Lee",
      source_url: "https://www.linkedin.com/posts/sam-lee-1",
      published_at: nowIso,
    });
    expect(reviews[1]).toMatchObject({
      platform: "x",
      reviewer_name: "@dev_maya",
      source_url: "https://x.com/dev_maya/status/999",
      published_at: nowIso,
    });
  });

  it("handles sleeping or failing Jirosearch microservice gracefully by returning an empty array", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com/";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Service Unavailable", { status: 503 })),
    );
    await expect(scrapeJirosearch("Acme", ["x", "linkedin"])).resolves.toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed / timeout")));
    await expect(scrapeJirosearch("Acme", ["instagram", "facebook"])).resolves.toEqual([]);

    delete process.env["JIRO_SEARCH_URL"];
    delete process.env["JIROSEARCH_API_KEY"];
    await expect(scrapeJirosearch("Acme", ["pinterest"])).resolves.toEqual([]);
  });

  it("routes all Jirosearch platforms cleanly in scrapePlatform", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    const nowIso = new Date().toISOString();
    const urlByPlatform: Record<string, string> = {
      x: "https://x.com/alex_rivera/status/123456",
      youtube: "https://www.youtube.com/watch?v=abc123",
      linkedin: "https://www.linkedin.com/posts/alex-rivera-1",
      instagram: "https://www.instagram.com/p/abc123/",
      tiktok: "https://www.tiktok.com/@alex/video/123456",
      facebook: "https://www.facebook.com/alex/posts/123456",
      telegram: "https://t.me/saaschat/123",
      pinterest: "https://www.pinterest.com/pin/123456/",
    };

    const platformOrder = [
      "x",
      "youtube",
      "linkedin",
      "instagram",
      "tiktok",
      "facebook",
      "telegram",
      "pinterest",
    ] as const;

    let callIdx = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String(init?.body ?? "{}")) as {
        query?: string;
        platforms?: string[];
      };
      expect(typeof sent.query).toBe("string");
      expect(Array.isArray(sent.platforms)).toBe(true);

      const target = sent.platforms?.[0] ?? platformOrder[callIdx++] ?? "x";
      return new Response(
        JSON.stringify({
          results: [
            {
              source: target,
              body: `Review on ${target} about Acme.`,
              reviewerName: "Alex Rivera",
              reviewedAt: nowIso,
              sourceUrl: urlByPlatform[target],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    for (const p of platformOrder) {
      const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, p);
      expect(res.status).toBe("ok");
      expect(res.reviews).toHaveLength(1);
      expect(res.reviews[0]?.platform).toBe(p);
    }
  });

  it("parses relative publication dates without inventing a date for unknown snippets", async () => {
    const { parseSnippetDate } = await import("./scrapers.server");
    const yearsOld = parseSnippetDate("Published 4 years ago");
    expect(yearsOld).not.toBe("");
    expect(Date.now() - new Date(yearsOld).getTime()).toBeGreaterThan(
      3 * 365 * 24 * 60 * 60 * 1000,
    );
    expect(parseSnippetDate("No publication date shown")).toBe("");
  });

  it("filters old Jirosearch social posts through the same 48-hour gate", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              source: "x",
              text: "Acme support has been frustrating.",
              reviewerName: "Old Poster",
              createdAt: oldDate,
              url: "https://x.com/oldposter/status/123456",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "x");

    expect(res.status).toBe("ok");
    expect(res.reviews).toHaveLength(0);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      query?: string;
      platforms?: string[];
    };
    expect(sentBody.query).toContain("after:");
    expect(sentBody.platforms).toEqual(["x"]);
  });

  it("keeps the existing historical mode when the 48-hour filter is explicitly disabled", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              source: "x",
              text: "Acme support has been frustrating.",
              reviewerName: "Historical Poster",
              createdAt: oldDate,
              url: "https://x.com/historical/status/123456",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "x", {
      apply48HourFilter: false,
    });

    expect(res.status).toBe("ok");
    expect(res.reviews).toHaveLength(1);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as {
      query?: string;
      platforms?: string[];
    };
    expect(sentBody.query).not.toContain("after:");
    expect(sentBody.platforms).toEqual(["x"]);
  });

  it("recovers a missing social-post date from publication metadata before filtering", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    const publishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes("jiro-search-api-xyz.onrender.com")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                source: "x",
                text: "Acme support has been frustrating.",
                reviewerName: "Recent Poster",
                url: "https://www.linkedin.com/posts/recent-1",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        `<html><head><meta property="article:published_time" content="${publishedAt}" /></head></html>`,
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "x");

    expect(res.status).toBe("ok");
    expect(res.reviews).toHaveLength(1);
    expect(res.reviews[0]?.published_at).toBe(publishedAt);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects undated posts when publication metadata cannot be recovered", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes("jiro-search-api-xyz.onrender.com")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                source: "x",
                text: "Acme support has been frustrating.",
                reviewerName: "Unknown Date Poster",
                url: "https://www.linkedin.com/posts/unknown-1",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("<html><head><title>Post</title></head></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "x");

    expect(res.status).toBe("ok");
    expect(res.reviews).toHaveLength(0);
  });
});

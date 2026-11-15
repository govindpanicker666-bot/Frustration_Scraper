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

  it("parses relative publication dates without inventing a date for unknown snippets", async () => {
    const { parseSnippetDate } = await import("./scrapers.server");
    const yearsOld = parseSnippetDate("Published 4 years ago");
    expect(yearsOld).not.toBe("");
    expect(Date.now() - new Date(yearsOld).getTime()).toBeGreaterThan(3 * 365 * 24 * 60 * 60 * 1000);
    expect(parseSnippetDate("No publication date shown")).toBe("");
  });

  it("filters old Jirosearch social posts through the same 48-hour gate", async () => {
    process.env["JIROSEARCH_API_KEY"] = "test-jiro-key";
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{
            source: "x",
            text: "Acme support has been frustrating.",
            reviewerName: "Old Poster",
            createdAt: oldDate,
            url: "https://x.com/oldposter/status/123456",
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "x");

    expect(res.status).toBe("ok");
    expect(res.reviews).toHaveLength(0);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as { query?: string };
    expect(sentBody.query).toContain("after:");
  });

  it("keeps the existing historical mode when the 48-hour filter is explicitly disabled", async () => {
    process.env["JIROSEARCH_API_KEY"] = "test-jiro-key";
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{
            source: "x",
            text: "Acme support has been frustrating.",
            reviewerName: "Historical Poster",
            createdAt: oldDate,
            url: "https://x.com/historical/status/123456",
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await scrapePlatform(
      { name: "Acme", domain: "acme.com" },
      "x",
      { apply48HourFilter: false },
    );

    expect(res.status).toBe("ok");
    expect(res.reviews).toHaveLength(1);
    const sentBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as { query?: string };
    expect(sentBody.query).not.toContain("after:");
  });

  it("recovers a missing social-post date from publication metadata before filtering", async () => {
    process.env["JIROSEARCH_API_KEY"] = "test-jiro-key";
    const publishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes("api.jirosearch.com")) {
        return new Response(
          JSON.stringify({
            results: [{
              source: "x",
              text: "Acme support has been frustrating.",
              reviewerName: "Recent Poster",
              url: "https://example.com/posts/recent-1",
            }],
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
    process.env["JIROSEARCH_API_KEY"] = "test-jiro-key";
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes("api.jirosearch.com")) {
        return new Response(
          JSON.stringify({
            results: [{
              source: "x",
              text: "Acme support has been frustrating.",
              reviewerName: "Unknown Date Poster",
              url: "https://example.com/posts/unknown-1",
            }],
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

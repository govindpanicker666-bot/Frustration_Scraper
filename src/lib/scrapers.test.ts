import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORMS } from "./pipeline";
import {
  mapSocialFetchFacebookPost,
  mapSocialFetchInstagramPosts,
  mapSocialFetchRedditPosts,
  scrapeJirosearch,
  scrapePlatform,
} from "./scrapers.server";

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

  it("keeps the replaced and unaffected platform IDs in the supported platform list", () => {
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

  it("does not require Jirosearch configuration for X, Instagram or Facebook", async () => {
    delete process.env["JIRO_SEARCH_URL"];
    delete process.env["JIROSEARCH_API_URL"];
    delete process.env["JIROSEARCH_API_KEY"];
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      if (String(input).includes("x-lookup.mynameistito.com")) {
        return new Response(
          JSON.stringify({
            resource: "search",
            posts: [{
              id: "1234567890123456789",
              url: "https://x.com/alex/status/1234567890123456789",
              text: "Acme support is broken.",
              created_at: new Date().toISOString(),
              author: { screen_name: "alex" },
            }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("<html><body>No linked social accounts</body></html>", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const x = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "x");
    const instagram = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "instagram");
    const facebook = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "facebook");
    expect(x.status).toBe("ok");
    expect(x.reviews).toHaveLength(1);
    expect(instagram.status).toBe("no_match");
    expect(facebook.status).toBe("no_match");
    expect(instagram.status).not.toBe("no_key");
    expect(facebook.status).not.toBe("no_key");
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("jiro-search-api"))).toBe(false);
  });

  it("sends separate /social/search requests per platform with { query, platform, limit: 10 } and maps results", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    delete process.env["JIROSEARCH_API_KEY"];
    const nowIso = new Date().toISOString();

    const urlByPlatform: Record<string, string> = {
      youtube: "https://www.youtube.com/watch?v=abc123",
      pinterest: "https://www.pinterest.com/pin/123456/",
      linkedin: "https://www.linkedin.com/posts/sam-lee-1",
      tiktok: "https://www.tiktok.com/@alex/video/123456",
    };

    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String(init?.body ?? "{}")) as {
        query?: string;
        platform?: string;
        limit?: number;
      };
      const target = sent.platform ?? "linkedin";
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Support frustration",
              content: `Acme issue reported on ${target}.`,
              author: target === "x" ? "@jane_founder" : "Alex Rivera",
              url: urlByPlatform[target],
              date: nowIso,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const platforms = ["youtube", "pinterest", "linkedin", "tiktok"];
    const reviews = await scrapeJirosearch("Acme", platforms);

    expect(fetchMock).toHaveBeenCalledTimes(platforms.length);
    for (const p of platforms) {
      expect(fetchMock).toHaveBeenCalledWith(
        "https://jiro-search-api-xyz.onrender.com/social/search",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            query: "Acme",
            platform: p,
            limit: 10,
          }),
        }),
      );
    }

    expect(reviews).toHaveLength(platforms.length);
    expect(reviews[0]).toMatchObject({
      platform: "youtube",
      reviewer_name: "Alex Rivera",
      source_url: "https://www.youtube.com/watch?v=abc123",
      published_at: nowIso,
    });
    expect(reviews[2]).toMatchObject({
      platform: "linkedin",
      reviewer_name: "Alex Rivera",
      source_url: "https://www.linkedin.com/posts/sam-lee-1",
      published_at: nowIso,
    });
  });

  it("continues scraping remaining platforms if one platform fails or is blocked", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    const nowIso = new Date().toISOString();

    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String(init?.body ?? "{}")) as { platform?: string };
      if (sent.platform === "youtube") {
        return new Response("Forbidden", { status: 403 });
      }
      if (sent.platform === "tiktok") {
        throw new Error("Network reset");
      }
      return new Response(
        JSON.stringify({
          results: [
            {
              title: "Post title",
              content: "Migrating off Acme today.",
              author: "Sam Lee",
              url: `https://www.${sent.platform}.com/posts/123`,
              published_at: nowIso,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const reviews = await scrapeJirosearch("Acme", ["youtube", "linkedin", "tiktok", "pinterest"]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(reviews).toHaveLength(2);
    expect(reviews.map((r) => r.platform)).toEqual(["linkedin", "pinterest"]);
  });

  it("handles sleeping or failing Jirosearch microservice gracefully by returning an empty array", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com/";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Service Unavailable", { status: 503 })),
    );
    await expect(scrapeJirosearch("Acme", ["youtube", "linkedin"])).resolves.toEqual([]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed / timeout")));
    await expect(scrapeJirosearch("Acme", ["tiktok", "pinterest"])).resolves.toEqual([]);

    delete process.env["JIRO_SEARCH_URL"];
    delete process.env["JIROSEARCH_API_KEY"];
    await expect(scrapeJirosearch("Acme", ["pinterest"])).resolves.toEqual([]);
  });

  it("routes all Jirosearch platforms cleanly in scrapePlatform", async () => {
    process.env["JIRO_SEARCH_URL"] = "https://jiro-search-api-xyz.onrender.com";
    const nowIso = new Date().toISOString();
    const urlByPlatform: Record<string, string> = {
      youtube: "https://www.youtube.com/watch?v=abc123",
      tiktok: "https://www.tiktok.com/@alex/video/123456",
      telegram: "https://t.me/saaschat/123",
      pinterest: "https://www.pinterest.com/pin/123456/",
    };

    const platformOrder = [
      "youtube",
      "tiktok",
      "telegram",
      "pinterest",
    ] as const;

    let callIdx = 0;
    const fetchMock = vi.fn().mockImplementation(async (_url, init) => {
      const sent = JSON.parse(String(init?.body ?? "{}")) as {
        query?: string;
        platform?: string;
        limit?: number;
      };
      expect(typeof sent.query).toBe("string");
      expect(typeof sent.platform).toBe("string");
      expect(sent.limit).toBe(10);

      const target = sent.platform ?? platformOrder[callIdx++] ?? "linkedin";
      expect(sent.platform).toBe(target);
      return new Response(
        JSON.stringify({
          results: [
            {
              title: `Post on ${target}`,
              content: `Review on ${target} about Acme.`,
              author: "Alex Rivera",
              url: urlByPlatform[target],
              reviewedAt: nowIso,
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


  it("normalizes SocialFetch Reddit search results into the existing RawReview shape", () => {
    const mapped = mapSocialFetchRedditPosts({
      posts: [{
        id: "abc123",
        author: "jane_doe",
        title: "Acme support never responds",
        selftext: "I have waited three weeks for a reply.",
        permalink: "/r/SaaS/comments/abc123/acme_support/",
        created_utc: 1_800_000_000,
      }],
    });
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      platform: "reddit",
      reviewer_name: "jane_doe",
      reviewer_profile_url: "https://www.reddit.com/user/jane_doe/",
      source_url: "https://www.reddit.com/r/SaaS/comments/abc123/acme_support/",
      text: "Acme support never responds. I have waited three weeks for a reply.",
      published_at: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it("normalizes SocialFetch Instagram recent posts from a known public profile", () => {
    const mapped = mapSocialFetchInstagramPosts({
      username: "acme",
      recent: [{
        shortcode: "ABC123",
        url: "https://www.instagram.com/p/ABC123/",
        caption: "Acme app keeps crashing after the latest update.",
        taken_at: 1_800_000_000,
      }],
    }, "acme");
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({
      platform: "instagram",
      reviewer_name: "@acme",
      reviewer_profile_url: "https://www.instagram.com/acme/",
      source_url: "https://www.instagram.com/p/ABC123/",
      published_at: new Date(1_800_000_000 * 1000).toISOString(),
    });
  });

  it("does not invent a Facebook post date when SocialFetch oEmbed does not return one", () => {
    const mapped = mapSocialFetchFacebookPost({
      url: "https://www.facebook.com/acme/posts/123",
      title: "Acme service review",
      author: "Acme",
    });
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.platform).toBe("facebook");
    expect(mapped[0]?.published_at).toBe("");
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

  it("uses X Lookup for latest keyword search and keeps the shared 48-hour gate", async () => {
    delete process.env["JIRO_SEARCH_URL"];
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          resource: "search",
          posts: [{
            id: "1234567890123456789",
            url: "https://x.com/oldposter/status/1234567890123456789",
            text: "Acme support has been frustrating.",
            created_at: oldDate,
            author: { screen_name: "oldposter", url: "https://x.com/oldposter" },
          }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "x");

    expect(res.status).toBe("ok");
    expect(res.reviews).toHaveLength(0);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.hostname).toBe("x-lookup.mynameistito.com");
    expect(requestUrl.pathname).toBe("/search");
    expect(requestUrl.searchParams.get("q")).toContain("since:");
    expect(requestUrl.searchParams.get("feed")).toBe("latest");
    expect(requestUrl.searchParams.get("format")).toBe("json");
  });

  it("keeps historical X Lookup results when the 48-hour filter is explicitly disabled", async () => {
    delete process.env["JIRO_SEARCH_URL"];
    const oldDate = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          resource: "search",
          posts: [{
            id: "1234567890123456789",
            text: "Acme support has been frustrating.",
            created_at: oldDate,
            url: "https://x.com/historical/status/1234567890123456789",
            author: { screen_name: "historical" },
          }],
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
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requestUrl.searchParams.get("q")).not.toContain("since:");
    expect(requestUrl.searchParams.get("feed")).toBe("latest");
  });

  it("recovers a missing X post date from publication metadata before filtering", async () => {
    delete process.env["JIRO_SEARCH_URL"];
    const publishedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes("x-lookup.mynameistito.com")) {
        return new Response(
          JSON.stringify({
            resource: "search",
            posts: [{
              id: "not-a-snowflake",
              text: "Acme support has been frustrating.",
              author: { screen_name: "recentposter" },
              url: "https://www.linkedin.com/posts/recent-1",
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

  it("rejects undated X posts when publication metadata cannot be recovered", async () => {
    delete process.env["JIRO_SEARCH_URL"];
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL | Request) => {
      if (String(url).includes("x-lookup.mynameistito.com")) {
        return new Response(
          JSON.stringify({
            resource: "search",
            posts: [{
              id: "not-a-snowflake",
              text: "Acme support has been frustrating.",
              author: { screen_name: "undatedposter" },
              url: "https://www.linkedin.com/posts/unknown-1",
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

  it("searches public Mastodon hashtag timelines across instances and applies the strict 48-hour cutoff", async () => {
    delete process.env["JIRO_SEARCH_URL"];
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const fetchMock = vi.fn().mockImplementation(async (input: string | URL | Request) => {
      const host = new URL(String(input)).hostname;
      const statuses = host === "mastodon.social"
        ? [
            { id: "1", url: "https://mastodon.social/@alice/1", content: "<p>Acme export is painfully slow.</p>", created_at: recent, visibility: "public", account: { display_name: "Alice Doe", acct: "alice@mastodon.social", url: "https://mastodon.social/@alice" } },
            { id: "2", url: "https://mastodon.social/@bob/2", content: "<p>Acme was broken last week.</p>", created_at: old, visibility: "public", account: { display_name: "Bob Doe", acct: "bob@mastodon.social", url: "https://mastodon.social/@bob" } },
          ]
        : [
            { id: "3", url: `https://${host}/@carol/3`, content: "<p>Acme sync failed again.</p>", created_at: recent, visibility: "public", account: { display_name: "Carol Doe", acct: `carol@${host}`, url: `https://${host}/@carol` } },
          ];
      return new Response(JSON.stringify(statuses), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await scrapePlatform({ name: "Acme", domain: "acme.com" }, "mastodon");
    expect(result.status).toBe("ok");
    expect(result.reviews.length).toBeGreaterThanOrEqual(1);
    expect(result.reviews.every((review) => Date.now() - Date.parse(review.published_at) <= 48 * 60 * 60 * 1000)).toBe(true);
    expect(new Set(fetchMock.mock.calls.map(([url]) => new URL(String(url)).hostname)).size).toBeGreaterThan(1);
    expect(result.reviews.some((review) => review.source_url.includes("/@carol/"))).toBe(true);
  });

});

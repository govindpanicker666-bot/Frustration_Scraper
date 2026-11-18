import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  isLinkedInPostWithin24Hours,
  LinkedInScraperError,
  normalizeLinkedInPostUrl,
  normalizeLinkedInScrapedPosts,
  normalizeThreadsSearchPosts,
  parseLinkedInSearchDate,
  resolvePlaywrightBrowsersPath,
} from "./public-social-scrapers.server";

describe("public social scraper normalizers", () => {
  it("validates and canonicalizes LinkedIn post URLs", () => {
    expect(
      normalizeLinkedInPostUrl("https://uk.linkedin.com/posts/alex_topic-activity-123?trk=feed"),
    ).toBe("https://www.linkedin.com/posts/alex_topic-activity-123");
    expect(
      normalizeLinkedInPostUrl(
        "https://www.linkedin.com/feed/update/urn:li:activity:123?utm_source=x",
      ),
    ).toBe("https://www.linkedin.com/feed/update/urn:li:activity:123");
    expect(normalizeLinkedInPostUrl("https://linkedin.com/in/alex")).toBeNull();
    expect(
      normalizeLinkedInPostUrl("https://evil.example/?url=https://linkedin.com/posts/alex"),
    ).toBeNull();
    const bingEncoded =
      "a1aHR0cHM6Ly93d3cubGlua2VkaW4uY29tL3Bvc3RzL2FsZXhfdG9waWMtYWN0aXZpdHktMTIz";
    expect(normalizeLinkedInPostUrl("https://www.bing.com/ck/a?u=" + bingEncoded)).toBe(
      "https://www.linkedin.com/posts/alex_topic-activity-123",
    );
  });

  it("retains the complete LinkedIn post body, author and timestamp", () => {
    const body = "A complete public post body. ".repeat(300);
    const posts = normalizeLinkedInScrapedPosts({
      posts: [
        {
          url: "https://www.linkedin.com/posts/alex_topic-activity-123",
          text: body,
          published_at: "2026-11-17T10:00:00Z",
          author_name: "Alex Doe",
          author_url: "https://www.linkedin.com/in/alex-doe",
        },
      ],
    });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.text).toBe(body.trim());
    expect(posts[0]?.authorUrl).toBe("https://www.linkedin.com/in/alex-doe");
    expect(posts[0]?.publishedAt).toBe("2026-11-17T10:00:00.000Z");
  });
  it("parses LinkedIn result-card relative timestamps without reading ordinary post text as a date", () => {
    const now = Date.parse("2026-11-18T12:00:00.000Z");
    expect(parseLinkedInSearchDate("Duncan Lennox · 2 hours ago · 190 reactions", now)).toBe(
      "2026-11-18T10:00:00.000Z",
    );
    expect(parseLinkedInSearchDate("Duncan Lennox · 2h · 190 reactions", now)).toBe(
      "2026-11-18T10:00:00.000Z",
    );
    expect(parseLinkedInSearchDate("Duncan Lennox · 1 day ago · 190 reactions", now)).toBe(
      "2026-11-17T12:00:00.000Z",
    );
    expect(parseLinkedInSearchDate("Posted today · 190 reactions", now)).toBe(
      "2026-11-18T12:00:00.000Z",
    );
    expect(
      parseLinkedInSearchDate("I am frustrated because today the app failed again.", now),
    ).toBe("");
  });

  it("applies a rolling 24-hour boundary to LinkedIn posts", () => {
    const now = Date.parse("2026-11-18T12:00:00.000Z");
    expect(isLinkedInPostWithin24Hours("2026-11-17T12:00:00.000Z", now)).toBe(true);
    expect(isLinkedInPostWithin24Hours("2026-11-17T11:59:59.999Z", now)).toBe(false);
    expect(isLinkedInPostWithin24Hours("2026-11-18T12:10:00.000Z", now)).toBe(false);
    expect(isLinkedInPostWithin24Hours("", now)).toBe(false);
  });

  it("retains full Threads text, timestamp and post link", () => {
    const body = "Full Threads post text. ".repeat(250);
    const posts = normalizeThreadsSearchPosts([
      {
        code: "DeaX_rOGaz-",
        url: "https://www.threads.com/@nasa/post/DeaX_rOGaz-?x=1",
        text: body,
        created_at: "2026-11-17T10:00:00+00:00",
        username: "nasa",
        full_name: "NASA",
      },
    ]);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe("https://www.threads.com/@nasa/post/DeaX_rOGaz-");
    expect(posts[0]?.text).toBe(body.trim());
    expect(posts[0]?.username).toBe("nasa");
  });

  it("resolves project-local .playwright-browsers consistently across Nitro .output/server paths and ignores '0'", () => {
    const root = mkdtempSync(join(tmpdir(), "pw-path-test-"));
    try {
      const browsersDir = join(root, ".playwright-browsers");
      const ssrDir = join(root, ".output", "server", "_ssr");
      mkdirSync(browsersDir, { recursive: true });
      mkdirSync(ssrDir, { recursive: true });

      expect(
        resolvePlaywrightBrowsersPath({
          cwd: root,
          moduleDir: ssrDir,
          envPath: "0",
        }),
      ).toBe(browsersDir);

      expect(
        resolvePlaywrightBrowsersPath({
          cwd: join(root, ".output", "server"),
          moduleDir: ssrDir,
          envPath: "/ms-playwright",
        }),
      ).toBe(browsersDir);

      const err = new LinkedInScraperError("chromium_missing", "missing");
      expect(err.kind).toBe("chromium_missing");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

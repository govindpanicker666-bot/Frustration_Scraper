import { describe, expect, it } from "vitest";
import { normalizeLinkedInPostUrl, normalizeLinkedInScrapedPosts, normalizeThreadsSearchPosts } from "./public-social-scrapers.server";

describe("public social scraper normalizers", () => {
  it("validates and canonicalizes LinkedIn post URLs", () => {
    expect(normalizeLinkedInPostUrl("https://uk.linkedin.com/posts/alex_topic-activity-123?trk=feed")).toBe("https://www.linkedin.com/posts/alex_topic-activity-123");
    expect(normalizeLinkedInPostUrl("https://www.linkedin.com/feed/update/urn:li:activity:123?utm_source=x")).toBe("https://www.linkedin.com/feed/update/urn:li:activity:123");
    expect(normalizeLinkedInPostUrl("https://linkedin.com/in/alex")).toBeNull();
    expect(normalizeLinkedInPostUrl("https://evil.example/?url=https://linkedin.com/posts/alex")).toBeNull();
  });
  it("retains the complete LinkedIn post body, author and timestamp", () => {
    const body = "A complete public post body. ".repeat(300);
    const posts = normalizeLinkedInScrapedPosts({ posts: [{
      url: "https://www.linkedin.com/posts/alex_topic-activity-123", text: body,
      published_at: "2026-11-17T10:00:00Z", author_name: "Alex Doe",
      author_url: "https://www.linkedin.com/in/alex-doe",
    }] });
    expect(posts).toHaveLength(1);
    expect(posts[0]?.text).toBe(body.trim());
    expect(posts[0]?.authorUrl).toBe("https://www.linkedin.com/in/alex-doe");
    expect(posts[0]?.publishedAt).toBe("2026-11-17T10:00:00.000Z");
  });
  it("retains full Threads text, timestamp and post link", () => {
    const body = "Full Threads post text. ".repeat(250);
    const posts = normalizeThreadsSearchPosts([{
      code: "DeaX_rOGaz-", url: "https://www.threads.com/@nasa/post/DeaX_rOGaz-?x=1",
      text: body, created_at: "2026-11-17T10:00:00+00:00", username: "nasa", full_name: "NASA",
    }]);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe("https://www.threads.com/@nasa/post/DeaX_rOGaz-");
    expect(posts[0]?.text).toBe(body.trim());
    expect(posts[0]?.username).toBe("nasa");
  });
});

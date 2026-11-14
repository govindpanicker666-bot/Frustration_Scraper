import { describe, it, expect } from "vitest";
import { deduplicateLeads, isNegativeAssessment } from "./pipeline";
import {
  parseFeed,
  feedCandidates,
  isRecent,
  keepReview,
  isLeadWorthy,
  contactAction,
  isRealName,
  isFullName,
  emailCandidates,
  decideLead,
  parseLinkedInTitle,
  domainOf,
  detectSpikes,
  linkedinAuthorFromPost,
  parseDdgHtml,
  parseBingRss,
  insightsStale,
  type RawReview,
} from "./pipeline";

const now = new Date("2026-11-11T12:00:00Z");
const base: RawReview = {
  platform: "hackernews",
  reviewer_name: "bob",
  reviewer_profile_url: null,
  source_url: "x",
  text: "t",
  published_at: now.toISOString(),
};

describe("48 hour filter", () => {
  it("keeps 47h old", () => expect(isRecent("2026-11-09T13:00:00Z", now)).toBe(true));
  it("drops 49h old", () => expect(isRecent("2026-11-09T11:00:00Z", now)).toBe(false));
});
describe("gatekeeper: real first + last name on review sites", () => {
  it("drops Anonymous", () =>
    expect(keepReview({ ...base, platform: "g2", reviewer_name: "Anonymous" }, now)).toBe(false));
  it("drops Verified User", () =>
    expect(isRealName("Verified User in Computer Software")).toBe(false));
  it("drops single first name", () =>
    expect(keepReview({ ...base, platform: "trustpilot", reviewer_name: "Jane" }, now)).toBe(
      false,
    ));
  it("drops initial-only surname", () => expect(isFullName("Jane D.")).toBe(false));
  it("keeps Jane Doe", () =>
    expect(keepReview({ ...base, platform: "g2", reviewer_name: "Jane Doe" }, now)).toBe(true));
  it("keeps HN handle", () => expect(keepReview(base, now)).toBe(true));
});
describe("score threshold", () => {
  it("1 is a lead", () => expect(isLeadWorthy(1)).toBe(true));
  it("0 is not", () => expect(isLeadWorthy(0)).toBe(false));
});
describe("actual negative evidence", () => {
  it("keeps slight negativity at score 1", () =>
    expect(
      isNegativeAssessment(
        { score: 1, sentiment: "negative", negative_quote: "slightly annoying" },
        "CapCut's menu is slightly annoying.",
      ),
    ).toBe(true));
  it("drops neutral at score 0", () =>
    expect(
      isNegativeAssessment(
        { score: 0, sentiment: "neutral", negative_quote: "" },
        "Made on CapCut AI Template yesterday.",
      ),
    ).toBe(false));
  it("drops positive mentions even if scored 1", () =>
    expect(
      isNegativeAssessment(
        { score: 1, sentiment: "positive", negative_quote: "" },
        "chat, i love Capcut",
      ),
    ).toBe(false));
  it("rejects invented negative evidence", () =>
    expect(
      isNegativeAssessment(
        { score: 1, sentiment: "negative", negative_quote: "terrible interface" },
        "Video edited using Wondershare Filmora 13.",
      ),
    ).toBe(false));
});
describe("person and cross-post deduplication", () => {
  const lead = {
    user_id: "u",
    competitor_id: "c",
    reviewer_name: "Ben T-97",
    reviewer_profile_url: "https://bsky.app/profile/ben",
    source_url: "https://bsky.app/profile/ben/post/1",
    review_text: "CapCut's interface is slightly annoying and takes too many clicks.",
  };
  it("collapses different display names on the same profile", () =>
    expect(
      deduplicateLeads([
        lead,
        {
          ...lead,
          reviewer_name: "Benjamin Tuckett",
          source_url: "https://bsky.app/profile/ben/post/2",
          review_text: "Another complaint",
        },
      ]),
    ).toHaveLength(1));
  it("collapses the same post across different platform accounts", () =>
    expect(
      deduplicateLeads([
        lead,
        {
          ...lead,
          reviewer_profile_url: "https://mastodon.social/@ben",
          source_url: "https://mastodon.social/@ben/123",
        },
      ]),
    ).toHaveLength(1));
  it("keeps different people who share a display name", () =>
    expect(
      deduplicateLeads([
        lead,
        {
          ...lead,
          reviewer_profile_url: "https://bsky.app/profile/other",
          source_url: "https://bsky.app/profile/other/post/2",
          review_text: "The export crashed.",
        },
      ]),
    ).toHaveLength(2));
  it("skips a known contact from previous runs", () =>
    expect(
      deduplicateLeads(
        [{ ...lead, email: "ben@example.com" }],
        [
          {
            ...lead,
            email: "ben@example.com",
            source_url: "https://x.com/ben/status/3",
            reviewer_profile_url: null,
            review_text: "Other complaint",
          },
        ],
      ),
    ).toHaveLength(0));
  it("does not merge complaints about different competitors", () =>
    expect(deduplicateLeads([lead, { ...lead, competitor_id: "other" }])).toHaveLength(2));
});
describe("email patterns", () => {
  it("first.last first", () =>
    expect(emailCandidates("Jane Doe", "acme.com")[0]).toBe("jane.doe@acme.com"));
  it("domain from url", () => expect(domainOf("https://www.Acme.com/x")).toBe("acme.com"));
});
describe("linkedin title parse", () => {
  it("name - title - company", () =>
    expect(parseLinkedInTitle("Jane Doe - Head of Ops - Acme Corp | LinkedIn")).toEqual({
      title: "Head of Ops",
      company: "Acme Corp",
    }));
});
describe("final save filter", () => {
  it("email wins", () =>
    expect(decideLead({ platform: "g2", email: "a@b.com", linkedin: "l", threadUrl: "t" })).toBe(
      "email",
    ));
  it("linkedin fallback", () =>
    expect(decideLead({ platform: "g2", email: null, linkedin: "l", threadUrl: "t" })).toBe(
      "linkedin",
    ));
  it("review with nothing is discarded", () =>
    expect(
      decideLead({ platform: "trustpilot", email: null, linkedin: null, threadUrl: "t" }),
    ).toBeNull());
  it("social thread is a Social Signal", () =>
    expect(
      decideLead({ platform: "hackernews", email: null, linkedin: null, threadUrl: "t" }),
    ).toBe("social_signal"));
});
describe("contact button", () => {
  it("linkedin", () =>
    expect(contactAction("https://www.linkedin.com/in/jane")?.label).toBe("View LinkedIn"));
  it("same as post -> hidden", () =>
    expect(
      contactAction(
        "https://news.ycombinator.com/item?id=1",
        "https://news.ycombinator.com/item?id=1",
      ),
    ).toBeNull());
  it("distinct profile", () =>
    expect(
      contactAction("https://bsky.app/profile/a.com", "https://bsky.app/profile/a.com/post/1")
        ?.label,
    ).toBe("View profile"));
  it("none", () => expect(contactAction(null)).toBeNull());
});
describe("feeds", () => {
  it("parses rss item", () =>
    expect(
      parseFeed(
        "<rss><item><title>Raised $10M</title><link>https://a.com/p</link><description>x</description></item></rss>",
      )[0]?.title,
    ).toBe("Raised $10M"));
  it("parses atom link", () =>
    expect(
      parseFeed('<feed><entry><title>T</title><link href="https://a.com/e"/></entry></feed>')[0]
        ?.link,
    ).toBe("https://a.com/e"));
  it("tries /feed first", () => expect(feedCandidates("a.com")[0]).toBe("https://a.com/feed"));
});

import { buildEmail, extractEmails, detectPattern } from "./pipeline";
describe("email finder helpers", () => {
  it("builds flast", () =>
    expect(buildEmail("Jane Doe", "acme.com", "flast")).toBe("jdoe@acme.com"));
  it("extracts personal emails, skips info@", () =>
    expect(
      extractEmails("mail info@acme.com or bob.smith@acme.com x@other.com", "acme.com"),
    ).toEqual(["bob.smith@acme.com"]));
  it("detects first.last", () =>
    expect(detectPattern(["bob.smith@acme.com", "ann.lee@acme.com"])).toBe("first.last"));
});

describe("spikes", () => {
  const n = new Date("2026-11-12T12:00:00Z");
  const mk = (h: number, c = "Price hike") => ({
    competitor_name: "Acme",
    extracted_complaint: c,
    date_scraped: new Date(n.getTime() - h * 3600_000).toISOString(),
  });
  it("3 today with no history is a spike", () =>
    expect(detectSpikes([mk(1), mk(2), mk(3)], n)).toHaveLength(1));
  it("2 today is not", () => expect(detectSpikes([mk(1), mk(2)], n)).toHaveLength(0));
  it("3 today vs 2/day usual is not", () =>
    expect(
      detectSpikes(
        [mk(1), mk(2), mk(3), ...Array.from({ length: 14 }, (_, i) => mk(30 + i * 10))],
        n,
      ),
    ).toHaveLength(0));
});
describe("linkedin post author", () => {
  it("parses slug", () =>
    expect(
      linkedinAuthorFromPost("https://www.linkedin.com/posts/jane-doe-12ab3_shopify-activity-1"),
    ).toEqual({ name: "Jane Doe", profile: "https://www.linkedin.com/in/jane-doe-12ab3" }));
});

describe("search parsing", () => {
  it("ddg", () => {
    const html =
      '<div class="result results_links x"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fx.com%2Fa%2Fstatus%2F1&amp;rut=1">Hi &amp; bye</a><a class="result__snippet" href="#">snip</a></div>';
    expect(parseDdgHtml(html)).toEqual([
      { url: "https://x.com/a/status/1", title: "Hi & bye", snippet: "snip" },
    ]);
  });
  it("bing rss", () => {
    expect(
      parseBingRss(
        "<item><title>T</title><link>https://a.com</link><description>D</description></item>",
      ),
    ).toEqual([{ url: "https://a.com", title: "T", snippet: "D" }]);
  });
});
describe("insights cache", () => {
  it("fresh when lead count same", () => expect(insightsStale({ lead_count: 5 }, 5)).toBe(false));
  it("stale on new lead", () => expect(insightsStale({ lead_count: 5 }, 6)).toBe(true));
  it("stale when never generated", () => expect(insightsStale(null, 0)).toBe(true));
});

import { parseNewsHtml as _pnh, extractNewsPicks, normalizeNewsType } from "./pipeline";
describe("parseNewsHtml and news picks", () => {
  it("reads JSON-LD articles from a blog page", () => {
    const html = `<script type="application/ld+json">{"@type":"BlogPosting","headline":"We raised $50M","url":"/blog/raise","datePublished":"2026-11-01"}</script>`;
    expect(_pnh(html, "https://acme.com/blog")[0]).toMatchObject({
      title: "We raised $50M",
      link: "https://acme.com/blog/raise",
    });
  });
  it("reads JSON-LD @type arrays and mainEntityOfPage fallback", () => {
    const html = `<script type="application/ld+json">{"@type":["Article","BlogPosting"],"headline":"Pricing Update 2026","mainEntityOfPage":{"@id":"https://acme.com/blog/pricing-2026"}}</script>`;
    expect(_pnh(html, "https://acme.com/blog")[0]).toMatchObject({
      title: "Pricing Update 2026",
      link: "https://acme.com/blog/pricing-2026",
    });
  });
  it("falls back to article links under the blog section (including www host)", () => {
    const html = `<a href="https://www.acme.com/blog/new-pricing-for-teams-2026">New pricing for teams starting in 2026</a><a href="/pricing">Pricing page link text here</a>`;
    const out = _pnh(html, "https://acme.com/blog");
    expect(out.map((o) => o.link)).toEqual([
      "https://www.acme.com/blog/new-pricing-for-teams-2026",
    ]);
  });
  it("resolves Atom alternate links and relative feed links when baseUrl is given", () => {
    const xml = `<feed><entry><title>Major Launch</title><link rel="self" href="https://acme.com/feed.xml"/><link rel="alternate" href="/blog/launch"/></entry></feed>`;
    expect(parseFeed(xml, "https://acme.com/feed.xml")[0]?.link).toBe(
      "https://acme.com/blog/launch",
    );
  });
  it("normalizes AI news picks across wrapper keys, string indices, and news types", () => {
    expect(normalizeNewsType("Acquisition")).toBe("funding");
    expect(normalizeNewsType("Pricing Change")).toBe("pricing");
    const picks = extractNewsPicks(
      {
        picks: [
          {
            index: "[1]",
            summary: "Raised Series B",
            type: "funding",
            why_it_matters: "A",
            tactical_advice: "B",
          },
          {
            index: 1,
            summary: "Duplicate",
            type: "other",
            why_it_matters: "C",
            tactical_advice: "D",
          },
          {
            index: 99,
            summary: "Out of bounds",
            type: "other",
            why_it_matters: "E",
            tactical_advice: "F",
          },
        ],
      },
      3,
    );
    expect(picks).toEqual([
      {
        index: 1,
        summary: "Raised Series B",
        type: "funding",
        why_it_matters: "A",
        tactical_advice: "B",
      },
    ]);
  });
});

import { PLATFORMS, platformLabel, isReviewSite } from "./pipeline";
describe("threads platform support", () => {
  it("registers Threads as a social platform", () => {
    expect(PLATFORMS.some((p) => p.id === "threads" && p.label === "Threads")).toBe(true);
    expect(platformLabel("threads")).toBe("Threads");
    expect(isReviewSite("threads")).toBe(false);
  });
  it("classifies a Threads post as social_signal and builds View profile action", () => {
    const postUrl = "https://www.threads.net/@aismr.ka/post/DdgaiIbCKMt";
    expect(
      decideLead({ platform: "threads", email: null, linkedin: null, threadUrl: postUrl }),
    ).toBe("social_signal");
    expect(contactAction("https://www.threads.net/@aismr.ka", postUrl)?.label).toBe("View profile");
  });
});

import { formatStatValue, safeAverageScore, isScrapeTimeoutError } from "./pipeline";
describe("dashboard stat formatting and timeout detection", () => {
  it("renders '-' instead of NaN, null, or undefined", () => {
    expect(formatStatValue(undefined)).toBe("-");
    expect(formatStatValue(null)).toBe("-");
    expect(formatStatValue(Number.NaN)).toBe("-");
    expect(formatStatValue(Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatStatValue("NaN")).toBe("-");
    expect(formatStatValue(42)).toBe("42");
    expect(formatStatValue(7.25, { decimals: 1 })).toBe("7.3");
  });
  it("computes average score safely when array is empty or contains NaN", () => {
    expect(safeAverageScore([])).toBe("-");
    expect(safeAverageScore([undefined, null, Number.NaN])).toBe("-");
    expect(safeAverageScore([6, Number.NaN, 8])).toBe("7.0");
  });
  it("detects proxy timeouts and HTML non-JSON error pages without catching normal app errors", () => {
    expect(isScrapeTimeoutError(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"..."))).toBe(
      true,
    );
    expect(isScrapeTimeoutError(new Error("HTTP 504 Gateway Timeout"))).toBe(true);
    expect(isScrapeTimeoutError(new Error("Any error"), 60_500)).toBe(true);
    expect(isScrapeTimeoutError(new Error("AI_QUOTA: Gemini daily limit reached"), 1200)).toBe(
      false,
    );
    expect(isScrapeTimeoutError(new Error("Admins only"), 500)).toBe(false);
  });
});

import {
  isOsintEligiblePlatform,
  extractOsintHandle,
  parseLinkookOutput,
  formatOsintContact,
} from "./pipeline";

describe("OSINT contact discovery helpers", () => {
  it("identifies eligible anonymous social platforms", () => {
    expect(isOsintEligiblePlatform("bluesky")).toBe(true);
    expect(isOsintEligiblePlatform("Threads")).toBe(true);
    expect(isOsintEligiblePlatform("mastodon")).toBe(true);
    expect(isOsintEligiblePlatform("reddit")).toBe(true);
    expect(isOsintEligiblePlatform("g2")).toBe(false);
    expect(isOsintEligiblePlatform(null)).toBe(false);
  });

  it("extracts clean handles from reviewer names and falls back to profile URLs", () => {
    expect(extractOsintHandle("@aismr.ka")).toBe("aismr.ka");
    expect(extractOsintHandle("ben.bsky.social")).toBe("ben");
    expect(extractOsintHandle("alice@mastodon.social")).toBe("alice");
    expect(extractOsintHandle("Anonymous", "https://www.threads.net/@johndoe")).toBe("johndoe");
    expect(extractOsintHandle("Jane Doe", null)).toBeNull();
  });

  it("parses Linkook Neo4j JSON and stdout lines while filtering duplicates and source URLs", () => {
    const neo4j = JSON.stringify({
      nodes: [
        {
          labels: ["SocialMediaAccount"],
          properties: { profile_url: "https://github.com/octocat" },
        },
        {
          labels: ["SocialMediaAccount"],
          properties: { profile_url: "https://www.threads.net/@octocat/" },
        },
        {
          labels: ["Email"],
          properties: { address: "OCTOCAT@github.com" },
        },
      ],
    });
    const stdout = [
      "[+] GitHub: https://github.com/octocat",
      "[+] Personal: https://octocat.dev.",
      "[+] Post: https://www.threads.net/@octocat/post/123",
    ].join("\n");

    expect(
      parseLinkookOutput(stdout, neo4j, [
        "https://www.threads.net/@octocat/post/123",
        "https://www.threads.net/@octocat",
      ]),
    ).toEqual(["https://github.com/octocat", "octocat@github.com", "https://octocat.dev"]);
  });

  it("formats whitelisted B2B URLs and emails while rejecting personal websites", () => {
    expect(formatOsintContact("https://github.com/octocat/Spoon-Knife")).toEqual({
      label: "GitHub Profile",
      href: "https://github.com/octocat",
      raw: "https://github.com/octocat",
      kind: "url",
    });
    expect(formatOsintContact("https://www.example.io/about")).toBeNull();
    expect(formatOsintContact("https://soundcloud.com/octocat")).toBeNull();
    expect(formatOsintContact("dev@example.com")).toEqual({
      label: "Email: dev@example.com",
      href: "mailto:dev@example.com",
      raw: "dev@example.com",
      kind: "email",
    });
    expect(formatOsintContact("not-a-url")).toBeNull();
  });

  it("parses aliens-eye Found entries, filters Maybe/Not Found, and prefers final_url", async () => {
    const { parseAliensEyeOutput, mergeOsintUrls } = await import("./pipeline");
    const report = JSON.stringify({
      variations: {
        octocat: {
          sites: {
            github: {
              status: "Found",
              code: 200,
              url: "https://github.com/octocat",
              final_url: "https://github.com/octocat",
            },
            "github.sponsors": {
              status: "Found",
              code: 200,
              url: "https://github.com/sponsors/octocat",
              final_url: "https://github.com/octocat",
            },
            producthunt: {
              status: "Maybe",
              code: 403,
              url: "https://www.producthunt.com/@octocat",
              final_url: "https://www.producthunt.com/@octocat",
            },
            threads: {
              status: "Found",
              code: 200,
              url: "https://www.threads.net/@octocat",
              final_url: "https://www.threads.net/@octocat",
            },
          },
        },
      },
    });

    const aliensUrls = parseAliensEyeOutput("", report, [
      "https://www.threads.net/@octocat/post/1",
      "https://www.threads.net/@octocat",
    ]);
    expect(aliensUrls).toEqual(["https://github.com/octocat"]);

    const merged = mergeOsintUrls([
      aliensUrls,
      ["https://github.com/octocat/", "octocat@github.com", "https://dev.to/octocat"],
    ]);
    expect(merged).toEqual(["https://github.com/octocat", "https://dev.to/octocat"]);
  });

  it("applies strict B2B whitelist, deduplicates repos to profile URL, and hides FB/IG/TikTok when LinkedIn or X is found", async () => {
    const { filterB2BProfileUrls, buildOsintStructuredContacts } = await import("./pipeline");

    const rawUrls = [
      "https://soundcloud.com/jdoe",
      "https://www.codechef.com/users/jdoe",
      "https://dev.to/jdoe",
      "https://medium.com/@jdoe",
      "https://johndoe.dev",
      "https://github.com/jdoe/repo-one",
      "https://github.com/jdoe/repo-two",
      "https://twitter.com/jdoe/status/12345",
      "https://www.linkedin.com/in/john-doe-123/details/experience",
      "https://www.instagram.com/jdoe/reels/",
      "https://www.facebook.com/jdoe",
      "https://www.tiktok.com/@jdoe/video/99",
      "https://www.crunchbase.com/person/john-doe",
      "https://angel.co/u/jdoe",
    ];

    const filtered = filterB2BProfileUrls(rawUrls);
    expect(filtered.socialProfiles).toEqual({
      linkedin: "https://www.linkedin.com/in/john-doe-123",
      twitter: "https://x.com/jdoe",
      github: "https://github.com/jdoe",
      crunchbase: "https://www.crunchbase.com/person/john-doe",
      wellfound: "https://wellfound.com/u/jdoe",
    });

    // When neither LinkedIn nor X is present, fallback FB/TikTok/IG are preserved
    const fallbackOnly = filterB2BProfileUrls([
      "https://soundcloud.com/jdoe",
      "https://www.instagram.com/jdoe/",
      "https://www.tiktok.com/@jdoe",
      "https://www.facebook.com/jdoe",
    ]);
    expect(fallbackOnly.socialProfiles).toEqual({
      facebook: "https://www.facebook.com/jdoe",
      tiktok: "https://www.tiktok.com/@jdoe",
      instagram: "https://www.instagram.com/jdoe",
    });

    // other_contacts only included when no whitelist profiles are found
    expect(
      buildOsintStructuredContacts({
        validatedUrls: ["https://github.com/jdoe"],
        emails: ["john@acme.io"],
        phones: ["+1 (415) 555-0192"],
      }),
    ).toEqual({
      emails: ["john@acme.io"],
      social_profiles: { github: "https://github.com/jdoe" },
      other_contacts: [],
    });

    expect(
      buildOsintStructuredContacts({
        validatedUrls: [],
        emails: ["john@acme.io"],
        phones: ["+1 (415) 555-0192"],
      }),
    ).toEqual({
      emails: ["john@acme.io"],
      social_profiles: {},
      other_contacts: ["+1 (415) 555-0192"],
    });
  });

  it("extracts emails and phone numbers from raw OSINT text while ignoring telemetry/assets", async () => {
    const { extractOsintEmailsAndPhones, normalizeStoredOsintContacts } =
      await import("./pipeline");

    const sample = `
      [+] Email: Founder@Acme.io
      [+] Avatar: logo@2x.png
      [+] Telemetry: "response_time": 0.123456789012, "timestamp": "20261113_092929"
      [+] Bio: Call me at +1 (415) 555-0192 or noreply@acme.io
      [+] Link: https://github.com/acme/123-456-7890
    `;

    expect(extractOsintEmailsAndPhones([sample])).toEqual({
      emails: ["founder@acme.io"],
      phones: ["+1 (415) 555-0192"],
    });

    // Legacy string array normalization also drops personal websites/random domains
    expect(
      normalizeStoredOsintContacts([
        "founder@acme.io",
        "https://personalblog.dev",
        "https://soundcloud.com/acme",
        "https://www.linkedin.com/in/founder-acme",
      ]),
    ).toEqual({
      emails: ["founder@acme.io"],
      social_profiles: { linkedin: "https://www.linkedin.com/in/founder-acme" },
      other_contacts: [],
    });
  });
});

import {
  leadsToCsv,
  normalizeBrandSentiment,
  mergeBrandMentions,
  summarizeBrandMentions,
  type BrandMention,
} from "./pipeline";

describe("leadsToCsv export helper", () => {
  it("outputs required columns and RFC-4180 escaping for commas, quotes, and newlines", () => {
    const csv = leadsToCsv([
      {
        reviewer_name: 'Jane "Ops" Doe',
        competitor_name: "Acme, Inc.",
        source_platform: "threads",
        sentiment_score: 9,
        extracted_complaint: 'Billing keeps failing,\n"support" never replies',
        date_scraped: "2026-11-12",
        email: "jane@acme.com",
        linkedin_url: "https://linkedin.com/in/jane",
        reviewer_profile_url: null,
        source_url: "https://www.threads.net/@jane/post/1",
      },
      {
        reviewer_name: null,
        competitor_name: "BetaCo",
        source_platform: "g2",
        sentiment_score: 7,
        extracted_complaint: "Slow export",
        date_scraped: "2026-11-11",
        email: null,
        linkedin_url: null,
        reviewer_profile_url: null,
        source_url: "https://g2.com/reviews/1",
      },
    ]);

    const rows = csv.split("\r\n");
    expect(rows[0]).toBe(
      "Reviewer Name,Competitor,Platform,Frustration Score,Complaint,Date,Contact URL/Email",
    );
    expect(rows[1]).toBe(
      '"Jane ""Ops"" Doe","Acme, Inc.",Threads,9,"Billing keeps failing,\n""support"" never replies",2026-11-12,jane@acme.com | https://linkedin.com/in/jane',
    );
    expect(rows[2]).toBe(",BetaCo,G2,7,Slow export,2026-11-11,https://g2.com/reviews/1");
  });
});

describe("brand listening sentiment & aggregation helpers", () => {
  it("clamps sentiment scores to [-10, +10] and assigns positive/neutral/negative buckets", () => {
    expect(normalizeBrandSentiment(15)).toEqual({ score: 10, sentiment: "positive" });
    expect(normalizeBrandSentiment(-18)).toEqual({ score: -10, sentiment: "negative" });
    expect(normalizeBrandSentiment(2)).toEqual({ score: 2, sentiment: "positive" });
    expect(normalizeBrandSentiment(-2)).toEqual({ score: -2, sentiment: "negative" });
    expect(normalizeBrandSentiment(1)).toEqual({ score: 1, sentiment: "neutral" });
    expect(normalizeBrandSentiment(-1)).toEqual({ score: -1, sentiment: "neutral" });
    expect(normalizeBrandSentiment(0, "positive")).toEqual({ score: 2, sentiment: "positive" });
    expect(normalizeBrandSentiment("not-a-number")).toEqual({ score: 0, sentiment: "neutral" });
  });

  it("merges and deduplicates mentions by source_url sorted newest first", () => {
    const older: BrandMention = {
      id: "1",
      platform: "reddit",
      author: "u/alice",
      author_url: null,
      source_url: "https://reddit.com/r/saas/1/",
      text: "Great product!",
      sentiment_score: 8,
      sentiment: "positive",
      summary: "Loves the speed.",
      published_at: "2026-11-10T10:00:00Z",
      scraped_at: "2026-11-10T12:00:00Z",
    };
    const updatedOlder: BrandMention = {
      ...older,
      sentiment_score: 9,
      summary: "Updated praise",
    };
    const newer: BrandMention = {
      ...older,
      id: "2",
      platform: "threads",
      source_url: "https://www.threads.net/@bob/post/2",
      sentiment_score: -6,
      sentiment: "negative",
      summary: "Pricing is confusing.",
      published_at: "2026-11-12T10:00:00Z",
    };

    const merged = mergeBrandMentions([older], [updatedOlder, newer]);
    expect(merged).toHaveLength(2);
    expect(merged[0]?.source_url).toBe("https://www.threads.net/@bob/post/2");
    expect(merged[1]?.sentiment_score).toBe(9);
  });

  it("summarizes sentiment breakdown, platform volume, and top positive/negative lists", () => {
    const mentions: BrandMention[] = [
      {
        id: "1",
        platform: "g2",
        author: "Alice",
        author_url: null,
        source_url: "https://g2.com/1",
        text: "Best UI ever",
        sentiment_score: 9,
        sentiment: "positive",
        summary: "Adored the UI",
        published_at: "2026-11-12T08:00:00Z",
        scraped_at: "2026-11-12T09:00:00Z",
      },
      {
        id: "2",
        platform: "threads",
        author: "Bob",
        author_url: null,
        source_url: "https://threads.net/@bob/1",
        text: "Pretty solid overall",
        sentiment_score: 5,
        sentiment: "positive",
        summary: "Solid tool",
        published_at: "2026-11-11T08:00:00Z",
        scraped_at: "2026-11-11T09:00:00Z",
      },
      {
        id: "3",
        platform: "threads",
        author: "Cara",
        author_url: null,
        source_url: "https://threads.net/@cara/1",
        text: "Pricing is high",
        sentiment_score: -8,
        sentiment: "negative",
        summary: "Pricing too expensive",
        published_at: "2026-11-12T10:00:00Z",
        scraped_at: "2026-11-12T11:00:00Z",
      },
      {
        id: "4",
        platform: "reddit",
        author: "Dan",
        author_url: null,
        source_url: "https://reddit.com/4",
        text: "Just saw their launch",
        sentiment_score: 0,
        sentiment: "neutral",
        summary: "Noted launch",
        published_at: "2026-11-10T10:00:00Z",
        scraped_at: "2026-11-10T11:00:00Z",
      },
    ];

    const summary = summarizeBrandMentions(mentions);
    expect(summary.total).toBe(4);
    expect(summary.positive).toBe(2);
    expect(summary.neutral).toBe(1);
    expect(summary.negative).toBe(1);
    expect(summary.positiveShare).toBe(50);
    expect(summary.avgScore).toBe(1.5);
    expect(summary.byPlatform[0]).toEqual({ platform: "threads", name: "Threads", mentions: 2 });
    expect(summary.topPositive.map((m) => m.sentiment_score)).toEqual([9, 5]);
    expect(summary.topNegative.map((m) => m.sentiment_score)).toEqual([-8]);
  });
});

import { shouldApply48HourBrandFilter } from "./pipeline";

describe("brand listening 48-hour baseline filter & exception", () => {
  it("disables the 48-hour filter on first baseline run for regular users", () => {
    expect(
      shouldApply48HourBrandFilter({
        has_completed_brand_baseline: false,
        email: "govindpanicker666@gmail.com",
      }),
    ).toBe(false);
    expect(
      shouldApply48HourBrandFilter({
        has_completed_brand_baseline: false,
        email: null,
      }),
    ).toBe(false);
  });

  it("enforces the 48-hour filter exception for boosted688@gmail.com even on first run", () => {
    expect(
      shouldApply48HourBrandFilter({
        has_completed_brand_baseline: false,
        email: "boosted688@gmail.com",
      }),
    ).toBe(true);
    expect(
      shouldApply48HourBrandFilter({
        has_completed_brand_baseline: false,
        email: " Boosted688@gmail.com ",
      }),
    ).toBe(true);
  });

  it("applies the 48-hour filter once baseline is already completed", () => {
    expect(
      shouldApply48HourBrandFilter({
        has_completed_brand_baseline: true,
        email: "govindpanicker666@gmail.com",
      }),
    ).toBe(true);
  });

  it("allows historical reviews in keepReview when skipRecencyCheck is true while still checking reviewer names", () => {
    const oldReview: RawReview = {
      platform: "reddit",
      reviewer_name: "alice_dev",
      reviewer_profile_url: "https://reddit.com/user/alice_dev",
      source_url: "https://reddit.com/r/saas/old",
      text: "We switched to Churnhound six months ago.",
      published_at: "2025-01-15T12:00:00Z",
    };

    expect(keepReview(oldReview, now)).toBe(false);
    expect(keepReview(oldReview, now, { skipRecencyCheck: true })).toBe(true);

    // Review sites still require a full name even during historical baseline
    expect(
      keepReview(
        {
          ...oldReview,
          platform: "g2",
          reviewer_name: "Anonymous",
        },
        now,
        { skipRecencyCheck: true },
      ),
    ).toBe(false);
  });
});

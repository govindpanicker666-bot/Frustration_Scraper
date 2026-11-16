// Pure, browser-safe helpers shared by the scraping pipeline and the UI.
export type Platform =
  | "hackernews"
  | "producthunt"
  | "trustpilot"
  | "capterra"
  | "g2"
  | "appstore"
  | "googleplay"
  | "bluesky"
  | "mastodon"
  | "forum"
  | "stackexchange"
  | "devto"
  | "reddit"
  | "complaintsboard"
  | "github"
  | "lemmy"
  | "medium"
  | "googlereviews"
  | "linkedin"
  | "x"
  | "alternativeto"
  | "discourse"
  | "quora"
  | "youtube"
  | "sitejabber"
  | "trustradius"
  | "feedback"
  | "bbb"
  | "threads"
  | "instagram"
  | "tiktok"
  | "facebook"
  | "telegram"
  | "pinterest";

export const PLATFORMS: { id: Platform; label: string; kind: "review" | "social" }[] = [
  { id: "hackernews", label: "Hacker News", kind: "social" },
  { id: "producthunt", label: "Product Hunt", kind: "review" },
  { id: "trustpilot", label: "Trustpilot", kind: "review" },
  { id: "capterra", label: "Capterra", kind: "review" },
  { id: "g2", label: "G2", kind: "review" },
  { id: "appstore", label: "App Store", kind: "review" },
  { id: "googleplay", label: "Google Play", kind: "review" },
  { id: "bluesky", label: "Bluesky", kind: "social" },
  { id: "mastodon", label: "Mastodon", kind: "social" },
  { id: "forum", label: "Community forums", kind: "social" },
  { id: "stackexchange", label: "Stack Overflow", kind: "social" },
  { id: "devto", label: "Dev.to", kind: "social" },
  { id: "reddit", label: "Reddit", kind: "social" },
  { id: "complaintsboard", label: "ComplaintsBoard", kind: "review" },
  { id: "github", label: "GitHub", kind: "social" },
  { id: "lemmy", label: "Lemmy", kind: "social" },
  { id: "medium", label: "Medium / Substack", kind: "social" },
  { id: "googlereviews", label: "Google-indexed reviews", kind: "review" },
  { id: "linkedin", label: "LinkedIn posts", kind: "social" },
  { id: "x", label: "X (Twitter)", kind: "social" },
  { id: "alternativeto", label: "AlternativeTo", kind: "review" },
  { id: "discourse", label: "Discourse forums", kind: "social" },
  { id: "quora", label: "Quora", kind: "social" },
  { id: "youtube", label: "YouTube comments", kind: "social" },
  { id: "sitejabber", label: "Sitejabber", kind: "review" },
  { id: "trustradius", label: "TrustRadius", kind: "review" },
  { id: "feedback", label: "Feedback boards (Canny/Featurebase/Upvoty)", kind: "social" },
  { id: "bbb", label: "Better Business Bureau", kind: "review" },
  { id: "threads", label: "Threads", kind: "social" },
  { id: "instagram", label: "Instagram", kind: "social" },
  { id: "tiktok", label: "TikTok", kind: "social" },
  { id: "facebook", label: "Facebook", kind: "social" },
  { id: "telegram", label: "Telegram", kind: "social" },
  { id: "pinterest", label: "Pinterest", kind: "social" },
];
export const platformLabel = (p: string) => PLATFORMS.find((x) => x.id === p)?.label ?? p;
export const isReviewSite = (p: string) => PLATFORMS.find((x) => x.id === p)?.kind === "review";

export interface RawReview {
  platform: Platform;
  reviewer_name: string | null;
  reviewer_profile_url: string | null;
  source_url: string;
  text: string;
  published_at: string; // ISO
}

export const MAX_AGE_HOURS = 48;
export const MIN_LEAD_SCORE = 1;

export function isRecent(publishedAt: string | Date, now: Date = new Date()): boolean {
  const t = new Date(publishedAt).getTime();
  if (Number.isNaN(t)) return false;
  const age = now.getTime() - t;
  return age >= -5 * 60_000 && age <= MAX_AGE_HOURS * 3_600_000;
}

const ANON =
  /^(anonymous|anon|verified (user|reviewer)|user|n\/a|\[deleted\]|deleted|guest|a g2 user|\[redacted\])$/i;
export function isRealName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = name.trim();
  if (n.length < 2 || ANON.test(n)) return false;
  if (/^verified user in/i.test(n) || /^user in /i.test(n) || /redacted/i.test(n)) return false;
  return true;
}

/** Real first + last name: two or more alphabetic words, no anonymous labels. */
export function isFullName(name: string | null | undefined): boolean {
  if (!isRealName(name)) return false;
  const parts = name!
    .trim()
    .split(/\s+/)
    .filter((p) => /^[\p{L}][\p{L}'.-]*$/u.test(p));
  return parts.length >= 2 && parts.filter((p) => p.replace(/\./g, "").length >= 2).length >= 2;
}

/** Step 1 gatekeeper. Review-site posts remain useful evidence even when the reviewer is anonymous. */
export function keepReview(
  r: RawReview,
  now: Date = new Date(),
  opts?: { skipRecencyCheck?: boolean },
): boolean {
  if (!opts?.skipRecencyCheck && !isRecent(r.published_at, now)) return false;
  if (isReviewSite(r.platform)) return Boolean(r.source_url);
  return !!r.reviewer_name && r.reviewer_name !== "[deleted]";
}

export const isLeadWorthy = (score: number) => score >= MIN_LEAD_SCORE;

/** Validate negative evidence while tolerating punctuation and small wording differences in AI quotes. */
export function isNegativeAssessment(
  s: { score: number; sentiment?: string; negative_quote?: string; complaint?: string },
  text: string,
): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim();

  const source = normalize(text);
  const hasSupportingEvidence = (candidate: string | undefined): boolean => {
    const evidence = normalize(candidate ?? "");
    if (evidence.length < 3) return false;
    if (source.includes(evidence)) return true;

    // Gemini occasionally changes punctuation, inserts/removes a small word, or
    // returns a short complaint phrase instead of a verbatim quote. Require at
    // least two meaningful words and a strong token overlap to avoid false matches.
    const tokens = [...new Set(evidence.split(" ").filter((token) => token.length > 1))];
    if (tokens.length < 2) return false;
    const sourceTokens = new Set(source.split(" "));
    const matches = tokens.filter((token) => sourceTokens.has(token)).length;
    const requiredMatches = tokens.length <= 2 ? tokens.length : Math.ceil(tokens.length * 0.75);
    return matches >= requiredMatches;
  };

  return (
    isLeadWorthy(s.score) &&
    s.sentiment === "negative" &&
    (hasSupportingEvidence(s.negative_quote) || hasSupportingEvidence(s.complaint))
  );
}

type LeadIdentity = {
  user_id?: string;
  competitor_id?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  reviewer_profile_url?: string | null;
  source_url: string;
  review_text: string;
};
function identityKeys(lead: LeadIdentity): string[] {
  const canonicalUrl = (value: string) => {
    try {
      const url = new URL(value);
      // HN identifies both profiles and posts through the id query parameter.
      const id = url.hostname === "news.ycombinator.com" ? url.searchParams.get("id") : null;
      return `${url.hostname.replace(/^www\./, "").replace(/^twitter\.com$/, "x.com")}${url.pathname.replace(/\/$/, "")}${id ? `?id=${id}` : ""}`.toLowerCase();
    } catch {
      return value.trim().toLowerCase();
    }
  };
  const keys = [`post:${canonicalUrl(lead.source_url)}`];
  if (lead.email) keys.push(`email:${lead.email.trim().toLowerCase()}`);
  if (lead.linkedin_url) keys.push(`profile:${canonicalUrl(lead.linkedin_url)}`);
  if (
    lead.reviewer_profile_url &&
    canonicalUrl(lead.reviewer_profile_url) !== canonicalUrl(lead.source_url)
  )
    keys.push(`profile:${canonicalUrl(lead.reviewer_profile_url)}`);
  const text = lead.review_text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  // Exact substantial cross-posts are evidence; display-name similarity is not.
  if (text.length >= 40) keys.push(`text:${text}`);
  return keys.map((key) => `${lead.user_id ?? ""}:${lead.competitor_id ?? ""}:${key}`);
}
export function deduplicateLeads<T extends LeadIdentity>(
  leads: T[],
  existing: LeadIdentity[] = [],
): T[] {
  const seen = new Set(existing.flatMap(identityKeys));
  return leads.filter((lead) => {
    const keys = identityKeys(lead);
    const duplicate = keys.some((key) => seen.has(key));
    keys.forEach((key) => seen.add(key));
    return !duplicate;
  });
}

/** Exact-phrase search term so "Omnia" doesn't match "Omnisphere". */
export const exactQuery = (name: string) => `"${name.replace(/"/g, "").trim()}"`;

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Common work-email patterns, most likely first. */
export function emailCandidates(fullName: string, domain: string): string[] {
  const parts = fullName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return [];
  const f = parts[0]!,
    l = parts[parts.length - 1]!;
  return [`${f}.${l}`, `${f}`, `${f[0]}${l}`, `${f}${l}`, `${f}_${l}`, `${f}${l[0]}`].map(
    (x) => `${x}@${domain}`,
  );
}

/** Parse a LinkedIn search-result title like "Jane Doe - Head of Ops - Acme | LinkedIn". */
export function parseLinkedInTitle(title: string): {
  title: string | null;
  company: string | null;
} {
  const clean = title.replace(/\s*[|·].*linkedin.*$/i, "").trim();
  const segs = clean
    .split(/\s+[-–—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (segs.length >= 3) return { title: segs[1] ?? null, company: segs[2] ?? null };
  if (segs.length === 2) {
    const m = segs[1]!.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
    return m ? { title: m[1]!, company: m[2]! } : { title: segs[1]!, company: null };
  }
  return { title: null, company: null };
}

export type LeadType = "email" | "linkedin" | "social_signal";
/** Step 5 final filter: returns the lead type, or null to discard. */
export function decideLead(x: {
  platform: string;
  email: string | null;
  linkedin: string | null;
  threadUrl: string | null;
}): LeadType | null {
  if (x.email) return "email";
  if (x.linkedin) return "linkedin";
  // A negative review is still a useful lead when the review URL is the only
  // available follow-up path; do not require a reviewer email or LinkedIn.
  if (x.threadUrl) return "social_signal";
  return null;
}

export type ContactAction = { kind: "linkedin" | "profile"; label: string; url: string } | null;
/** A profile link distinct from the original post. Returns null when it would just repeat the post link. */
export function contactAction(
  profileUrl: string | null | undefined,
  sourceUrl?: string | null,
): ContactAction {
  if (!profileUrl) return null;
  if (profileUrl.includes("linkedin.com/in/"))
    return { kind: "linkedin", label: "View LinkedIn", url: profileUrl };
  if (sourceUrl && profileUrl.split("?")[0] === sourceUrl.split("?")[0]) return null;
  return { kind: "profile", label: "View profile", url: profileUrl };
}

export function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function stripHtml(s: string) {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type NewsType = "funding" | "pr" | "pricing" | "product" | "other";
/** Candidate RSS/Atom feed URLs for a competitor site. */
export function feedCandidates(domain: string): string[] {
  return [
    "/feed",
    "/rss",
    "/blog/rss",
    "/blog/feed",
    "/rss.xml",
    "/feed.xml",
    "/blog/rss.xml",
    "/blog/feed.xml",
    "/blog/atom.xml",
    "/atom.xml",
    "/news/rss.xml",
    "/news/feed",
    "/changelog/rss.xml",
    "/changelog.xml",
    "/index.xml",
  ].map((p) => `https://${domain}${p}`);
}
/** Parse RSS or Atom XML into items (newest first as given). */
export function parseFeed(
  xml: string,
  baseUrl?: string,
): { title: string; link: string; summary: string; date: string }[] {
  const items = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const tag = (b: string, t: string) =>
    (b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i"))?.[1] ?? "")
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .trim();
  const resolveLink = (raw: string) => {
    const clean = raw.trim();
    if (!clean) return "";
    if (/^https?:\/\//i.test(clean)) return clean;
    if (!baseUrl) return "";
    try {
      return new URL(clean, baseUrl).toString();
    } catch {
      return "";
    }
  };
  return items
    .map((b) => {
      const rawLink =
        tag(b, "link") ||
        (b.match(/<link[^>]+rel=["']alternate["'][^>]*href=["']([^"']+)/i)?.[1] ??
          b.match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']alternate["']/i)?.[1] ??
          b.match(/<link[^>]+href=["']([^"']+)/i)?.[1] ??
          tag(b, "id"));
      return {
        title: stripHtml(tag(b, "title")),
        link: resolveLink(rawLink),
        summary: stripHtml(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(
          0,
          800,
        ),
        date: tag(b, "pubDate") || tag(b, "published") || tag(b, "updated"),
      };
    })
    .filter((i) => i.title && /^https?:/.test(i.link));
}

/** Candidate HTML news/blog pages for a competitor site. */
export function newsPageCandidates(domain: string): string[] {
  return [
    "/blog",
    "/news",
    "/newsroom",
    "/articles",
    "/press",
    "/changelog",
    "/updates",
    "/releases",
    "/whats-new",
  ].map((p) => `https://${domain}${p}`);
}
/** Extract dated or titled article links from an HTML blog/news index page (JSON-LD first, then <article>/links). */
export function parseNewsHtml(
  html: string,
  pageUrl: string,
): { title: string; link: string; summary: string; date: string }[] {
  const out: { title: string; link: string; summary: string; date: string }[] = [];
  const abs = (h: string) => {
    try {
      return new URL(h, pageUrl).toString();
    } catch {
      return "";
    }
  };
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) {
          n.forEach(walk);
          return;
        }
        if (!n || typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        const rawType = Array.isArray(o["@type"]) ? o["@type"].join(" ") : String(o["@type"] ?? "");
        const mainEntity =
          o["mainEntityOfPage"] && typeof o["mainEntityOfPage"] === "object"
            ? (o["mainEntityOfPage"] as Record<string, unknown>)["@id"]
            : o["mainEntityOfPage"];
        const urlVal = o["url"] ?? mainEntity ?? o["@id"];
        if (
          /Article|BlogPosting|NewsArticle/i.test(rawType) &&
          (o["headline"] || o["name"]) &&
          urlVal
        ) {
          out.push({
            title: stripHtml(String(o["headline"] ?? o["name"])),
            link: abs(String(urlVal)),
            summary: stripHtml(String(o["description"] ?? "")).slice(0, 800),
            date: String(o["datePublished"] ?? ""),
          });
        }
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(m[1]!));
    } catch {
      /* bad block */
    }
  }
  const base = new URL(pageUrl);
  const baseHost = base.hostname.replace(/^www\./, "").toLowerCase();
  const section = base.pathname.replace(/\/$/, "");
  for (const m of html.matchAll(/<article[\s\S]*?<\/article>/gi)) {
    const b = m[0];
    const href = b.match(/<a[^>]+href=["']([^"'#]+)["']/i)?.[1];
    const title = stripHtml(b.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] ?? "");
    if (href && title)
      out.push({
        title,
        link: abs(href),
        summary: stripHtml(b.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "").slice(0, 800),
        date: b.match(/<time[^>]*datetime=["']([^"']+)/i)?.[1] ?? "",
      });
  }
  if (out.length < 3) {
    for (const m of html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const link = abs(m[1]!);
      const title = stripHtml(m[2]!);
      let u: URL;
      try {
        u = new URL(link);
      } catch {
        continue;
      }
      if (
        u.hostname.replace(/^www\./, "").toLowerCase() !== baseHost ||
        !section ||
        !u.pathname.startsWith(section + "/") ||
        u.pathname.split("/").filter(Boolean).length < 2
      )
        continue;
      if (
        title.length < 12 ||
        title.length > 200 ||
        /^(page|next|prev|older|newer|category|tag|read more|learn more|view all|home|about|pricing|contact|careers|privacy|terms|login|sign in|sign up)\b/i.test(
          title,
        )
      )
        continue;
      out.push({ title, link, summary: "", date: "" });
    }
  }
  const seen = new Set<string>();
  return out
    .filter((i) => /^https?:/.test(i.link) && !seen.has(i.link) && seen.add(i.link))
    .slice(0, 15);
}

export interface NormalizedNewsPick {
  index: number;
  summary: string;
  type: NewsType;
  why_it_matters: string;
  tactical_advice: string;
}

export function normalizeNewsType(raw: unknown): NewsType {
  const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (v === "funding" || v === "pr" || v === "pricing" || v === "product" || v === "other") {
    return v;
  }
  if (/fund|rais|invest|acqui/i.test(v)) return "funding";
  if (/pric|plan|tier|cost/i.test(v)) return "pricing";
  if (/launch|releas|featur|product|ai|update/i.test(v)) return "product";
  if (/press|partner|award|lead|pr/i.test(v)) return "pr";
  return "other";
}

export function extractNewsPicks(rawOutput: unknown, poolLength: number): NormalizedNewsPick[] {
  const list = Array.isArray(rawOutput)
    ? rawOutput
    : rawOutput && typeof rawOutput === "object"
      ? (() => {
          const obj = rawOutput as Record<string, unknown>;
          for (const key of ["results", "picks", "insights", "items", "news"]) {
            if (Array.isArray(obj[key])) return obj[key] as unknown[];
          }
          return [];
        })()
      : [];

  const seen = new Set<number>();
  const picks: NormalizedNewsPick[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const rawIdx = rec["index"];
    const idx =
      typeof rawIdx === "number"
        ? rawIdx
        : typeof rawIdx === "string"
          ? Number(rawIdx.replace(/[^\d-]/g, ""))
          : Number.NaN;
    if (!Number.isInteger(idx) || idx < 0 || idx >= poolLength || seen.has(idx)) continue;
    seen.add(idx);
    picks.push({
      index: idx,
      summary: typeof rec["summary"] === "string" ? rec["summary"].trim() : "",
      type: normalizeNewsType(rec["type"] ?? rec["news_type"]),
      why_it_matters: typeof rec["why_it_matters"] === "string" ? rec["why_it_matters"].trim() : "",
      tactical_advice:
        typeof rec["tactical_advice"] === "string" ? rec["tactical_advice"].trim() : "",
    });
    if (picks.length >= 7) break;
  }
  return picks;
}

export type EmailPattern = "first.last" | "first" | "flast" | "firstlast" | "first_last" | "firstl";
const PATTERN_ORDER: EmailPattern[] = [
  "first.last",
  "first",
  "flast",
  "firstlast",
  "first_last",
  "firstl",
];
function nameParts(fullName: string): [string, string] | null {
  const p = fullName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  return p.length >= 2 ? [p[0]!, p[p.length - 1]!] : null;
}
export function buildEmail(fullName: string, domain: string, pattern: EmailPattern): string | null {
  const n = nameParts(fullName);
  if (!n) return null;
  const [f, l] = n;
  const local = {
    "first.last": `${f}.${l}`,
    first: f,
    flast: `${f[0]}${l}`,
    firstlast: `${f}${l}`,
    first_last: `${f}_${l}`,
    firstl: `${f}${l[0]}`,
  }[pattern];
  return `${local}@${domain}`;
}
/** Pull emails on `domain` out of HTML/text (ignores generic inboxes like info@). */
export function extractEmails(html: string, domain: string): string[] {
  const re = new RegExp(`[a-z0-9._%+-]+@(?:[a-z0-9-]+\\.)*${domain.replace(/\./g, "\\.")}`, "gi");
  const generic =
    /^(info|hello|contact|support|sales|admin|team|press|hr|jobs|careers|privacy|legal|help|noreply|no-reply|billing|marketing|office|mail)$/;
  return [...new Set((html.match(re) ?? []).map((e) => e.toLowerCase()))].filter(
    (e) => !generic.test(e.split("@")[0]!),
  );
}
/** Guess the company's pattern from known personal emails (local part shape). */
export function detectPattern(emails: string[]): EmailPattern | null {
  const counts = new Map<EmailPattern, number>();
  for (const e of emails) {
    const local = e.split("@")[0]!;
    const p: EmailPattern | null = /^[a-z]+\.[a-z]+$/.test(local)
      ? "first.last"
      : /^[a-z]+_[a-z]+$/.test(local)
        ? "first_last"
        : /^[a-z]{2,}$/.test(local)
          ? local.length <= 7
            ? "first"
            : "flast"
          : null;
    if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  let best: EmailPattern | null = null,
    n = 0;
  for (const p of PATTERN_ORDER)
    if ((counts.get(p) ?? 0) > n) {
      best = p;
      n = counts.get(p)!;
    }
  return best;
}

/** LinkedIn post URLs look like linkedin.com/posts/jane-doe-123_topic-activity-... -> profile URL. */
export function linkedinAuthorFromPost(url: string): { name: string; profile: string } | null {
  const m = url.match(/linkedin\.com\/posts\/([a-z0-9-]+?)_/i);
  if (!m) return null;
  const slug = m[1]!;
  const name = slug
    .split("-")
    .filter((w) => !/\d/.test(w))
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
  return { name, profile: `https://www.linkedin.com/in/${slug}` };
}

export interface Spike {
  competitor: string;
  complaint: string;
  today: number;
  baseline: number;
}
/** Spike = today >= 3 leads for one competitor+complaint and >= 3x its daily average over the previous 7 days. */
export function detectSpikes(
  leads: { competitor_name: string; extracted_complaint: string | null; date_scraped: string }[],
  now: Date = new Date(),
): Spike[] {
  const dayMs = 86_400_000,
    t = now.getTime();
  const map = new Map<string, { today: number; prior: number }>();
  for (const l of leads) {
    const age = t - new Date(l.date_scraped).getTime();
    if (!Number.isFinite(age) || age < 0 || age > 8 * dayMs) continue;
    const key = `${l.competitor_name}\u0000${(l.extracted_complaint ?? "Other").trim().toLowerCase()}`;
    const v = map.get(key) ?? { today: 0, prior: 0 };
    if (age <= dayMs) v.today++;
    else v.prior++;
    map.set(key, v);
  }
  const out: Spike[] = [];
  for (const [k, v] of map) {
    const baseline = v.prior / 7;
    if (v.today >= 3 && v.today >= 3 * Math.max(baseline, 1 / 3)) {
      const [competitor, complaint] = k.split("\u0000") as [string, string];
      out.push({ competitor, complaint, today: v.today, baseline: Math.round(baseline * 10) / 10 });
    }
  }
  return out.sort((a, b) => b.today - a.today);
}

// ---------- Free web search parsing (DuckDuckGo HTML, Bing RSS) ----------
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}
const decodeEnt = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
export function parseDdgHtml(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  for (const b of html.split(/class="result results_links/).slice(1)) {
    const a = b.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = a[1]!.replace(/&amp;/g, "&");
    const u = url.match(/uddg=([^&]+)/);
    if (u) {
      try {
        url = decodeURIComponent(u[1]!);
      } catch {
        /* keep */
      }
    }
    if (url.startsWith("//")) url = "https:" + url;
    if (/duckduckgo\.com\/y\.js/.test(url)) continue; // ads
    const sn = b.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ url, title: decodeEnt(a[2]!), snippet: sn ? decodeEnt(sn[1]!) : "" });
  }
  return out;
}
export function parseBingRss(xml: string): SearchResult[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((m) => {
      const g = (t: string) =>
        decodeEnt(m[1]!.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`))?.[1] ?? "");
      return { url: g("link"), title: g("title"), snippet: g("description") };
    })
    .filter((r) => /^https?:/.test(r.url));
}

/** Strategic recommendations are regenerated only when the lead count changed (or never generated). */
export function insightsStale(
  cached: { lead_count: number } | null,
  currentLeadCount: number,
): boolean {
  return !cached || cached.lead_count !== currentLeadCount;
}

/** Formats a dashboard/admin stat safely, returning "-" instead of NaN, undefined, or null. */
export function formatStatValue(
  value: number | string | null | undefined,
  options?: { decimals?: number },
): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "-";
    return options?.decimals !== undefined ? value.toFixed(options.decimals) : String(value);
  }
  const trimmed = value.trim();
  if (!trimmed || /^nan$/i.test(trimmed)) return "-";
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return "-";
  return options?.decimals !== undefined ? num.toFixed(options.decimals) : trimmed;
}

/** Computes a finite 1-decimal average from a list of scores, returning "-" when unavailable. */
export function safeAverageScore(scores: Array<number | null | undefined>): string {
  const valid = scores.filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (valid.length === 0) return "-";
  const sum = valid.reduce((acc, n) => acc + n, 0);
  const avg = sum / valid.length;
  return Number.isFinite(avg) ? avg.toFixed(1) : "-";
}

/** Detects proxy 60s timeouts or HTML/non-JSON error pages returned by an interrupted scrape request. */
export function isScrapeTimeoutError(err: unknown, elapsedMs = 0): boolean {
  if (elapsedMs >= 60_000) return true;
  const msg =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === "string"
        ? err
        : JSON.stringify(err ?? "");
  return /(scrape_client_timeout|unexpected token\s*['"]?<|not valid json|failed to execute 'json'|json\.parse|<!doctype|<html|text\/html|gateway timeout|timed out|timeout|504|502|aborted|aborterror|failed to fetch|networkerror|load failed)/i.test(
    msg,
  );
}

export const OSINT_PLATFORMS = new Set(["bluesky", "threads", "mastodon", "reddit"]);

export function isOsintEligiblePlatform(platform: string | null | undefined): boolean {
  if (!platform) return false;
  return OSINT_PLATFORMS.has(platform.trim().toLowerCase());
}

/** Extracts a clean single-token social handle suitable for Linkook CLI lookup. */
export function extractOsintHandle(
  reviewerName: string | null | undefined,
  profileUrl?: string | null,
): string | null {
  const cleanCandidate = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    let s = raw.trim().replace(/^@+/, "");
    // Handle Bluesky handles like `user.bsky.social` -> take prefix if it's a bsky.social subdomain
    if (/^[a-z0-9._-]+\.bsky\.social$/i.test(s)) {
      s = s.replace(/\.bsky\.social$/i, "");
    }
    // Mastodon handle like `user@mastodon.social`
    if (/^[a-z0-9._-]+@[a-z0-9.-]+$/i.test(s)) {
      s = s.split("@")[0] ?? s;
    }
    if (!/^[a-z0-9._-]{2,64}$/i.test(s)) return null;
    if (/^(anonymous|anon|deleted|\[deleted\]|unknown|guest)$/i.test(s)) return null;
    return s;
  };

  const fromName = cleanCandidate(reviewerName);
  if (fromName) return fromName;

  if (profileUrl) {
    try {
      const u = new URL(profileUrl);
      const parts = u.pathname.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) {
        const fromUrl = cleanCandidate(last);
        if (fromUrl) return fromUrl;
      }
    } catch {
      /* ignore invalid URL */
    }
  }
  return null;
}

/** Parses Linkook Neo4j JSON export and/or stdout lines into deduplicated URLs and emails. */
export function parseLinkookOutput(
  stdout: string,
  neo4jJson?: string | null,
  excludeUrls: Array<string | null | undefined> = [],
): string[] {
  const excluded = new Set(
    excludeUrls
      .filter((u): u is string => Boolean(u))
      .map((u) => u.trim().replace(/\/+$/, "").toLowerCase()),
  );
  const found = new Set<string>();

  const addValue = (raw: string) => {
    const trimmed = raw.trim().replace(/[),.;]+$/, "");
    if (!trimmed) return;
    if (/^https?:\/\//i.test(trimmed)) {
      const normalized = trimmed.replace(/\/+$/, "").toLowerCase();
      if (!excluded.has(normalized)) {
        found.add(trimmed);
      }
      return;
    }
    if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(trimmed)) {
      found.add(trimmed.toLowerCase());
    }
  };

  if (neo4jJson) {
    try {
      const parsed = JSON.parse(neo4jJson) as {
        nodes?: Array<{ labels?: string[]; properties?: Record<string, unknown> }>;
      };
      for (const node of parsed.nodes ?? []) {
        const labels = node.labels ?? [];
        const props = node.properties ?? {};
        if (labels.includes("SocialMediaAccount") && typeof props["profile_url"] === "string") {
          addValue(props["profile_url"]);
        }
        if (labels.includes("Email") && typeof props["address"] === "string") {
          addValue(props["address"]);
        }
      }
    } catch {
      /* fall through to stdout parsing */
    }
  }

  for (const line of stdout.split(/\r?\n/)) {
    const urlMatches = line.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
    for (const u of urlMatches) addValue(u);
    const emailMatches = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    for (const e of emailMatches) addValue(e);
  }

  return [...found];
}

function normalizeHttpUrl(raw: string): string | null {
  const cleaned = raw.trim().replace(/[),.;]+$/, "");
  if (!/^https?:\/\//i.test(cleaned)) return null;
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function urlDedupeKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`.toLowerCase();
  } catch {
    return rawUrl.trim().replace(/\/+$/, "").toLowerCase();
  }
}

/** Parses aliens-eye JSON report (or stdout fallback) into unique Found HTTP(S) URLs. */
export function parseAliensEyeOutput(
  stdout: string,
  jsonText?: string | null,
  excludeUrls: Array<string | null | undefined> = [],
): string[] {
  const excluded = new Set(
    excludeUrls.filter((u): u is string => Boolean(u)).map((u) => urlDedupeKey(u)),
  );
  const found = new Map<string, string>();

  const addUrl = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const normalized = normalizeHttpUrl(raw);
    if (!normalized) return;
    const key = urlDedupeKey(normalized);
    if (excluded.has(key) || found.has(key)) return;
    found.set(key, normalized);
  };

  const tryParseJson = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const candidates: string[] = [trimmed];
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
    }

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as Record<string, unknown>;
        const variations = parsed["variations"];
        if (variations && typeof variations === "object" && !Array.isArray(variations)) {
          for (const variation of Object.values(variations as Record<string, unknown>)) {
            if (!variation || typeof variation !== "object") continue;
            const sites = (variation as Record<string, unknown>)["sites"];
            if (!sites || typeof sites !== "object") continue;
            for (const entry of Object.values(sites as Record<string, unknown>)) {
              if (!entry || typeof entry !== "object") continue;
              const rec = entry as Record<string, unknown>;
              const status =
                typeof rec["status"] === "string" ? rec["status"].trim().toLowerCase() : "";
              if (status && status !== "found") continue;
              addUrl(rec["final_url"] || rec["url"]);
            }
          }
          return true;
        }
      } catch {
        /* try next candidate */
      }
    }
    return false;
  };

  const parsedFromFile = jsonText ? tryParseJson(jsonText) : false;
  const parsedFromStdout = !parsedFromFile && stdout ? tryParseJson(stdout) : false;

  if (!parsedFromFile && !parsedFromStdout && stdout) {
    for (const line of stdout.split(/\r?\n/)) {
      const urlMatches = line.match(/https?:\/\/[^\s"'<>|│]+/gi) ?? [];
      for (const u of urlMatches) addUrl(u);
    }
  }

  return [...found.values()];
}

/** Merges multiple lists of discovered OSINT URLs into a unique ordered HTTP(S) list. */
export function mergeOsintUrls(
  urlLists: string[][],
  excludeUrls: Array<string | null | undefined> = [],
): string[] {
  const excluded = new Set(
    excludeUrls.filter((u): u is string => Boolean(u)).map((u) => urlDedupeKey(u)),
  );
  const merged = new Map<string, string>();

  for (const list of urlLists) {
    for (const item of list) {
      const normalized = normalizeHttpUrl(item);
      if (!normalized) continue;
      const key = urlDedupeKey(normalized);
      if (excluded.has(key) || merged.has(key)) continue;
      merged.set(key, normalized);
    }
  }

  return [...merged.values()];
}

export type B2BSocialPlatform =
  | "linkedin"
  | "twitter"
  | "github"
  | "crunchbase"
  | "wellfound"
  | "facebook"
  | "tiktok"
  | "instagram";

export interface OsintStructuredContacts {
  emails: string[];
  social_profiles: Partial<Record<B2BSocialPlatform, string>>;
  other_contacts: string[];
}

const B2B_PRIORITY_ORDER: B2BSocialPlatform[] = [
  "linkedin",
  "twitter",
  "github",
  "crunchbase",
  "wellfound",
  "facebook",
  "tiktok",
  "instagram",
];

const IGNORED_EMAIL_TLDS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
  "css",
  "js",
  "mjs",
  "ts",
  "tsx",
  "json",
  "py",
  "woff",
  "woff2",
  "ttf",
  "eot",
  "map",
]);

const IGNORED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "localhost",
  "sentry.io",
  "wixpress.com",
  "github.com",
]);

/** Extracts unique email addresses and formatted phone numbers from raw CLI/JSON text. */
export function extractOsintEmailsAndPhones(rawTexts: Array<string | null | undefined>): {
  emails: string[];
  phones: string[];
} {
  const emails = new Set<string>();
  const phones = new Set<string>();

  const emailRe = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;
  const phoneRe =
    /(?:^|[^\d.])((?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{3}[\s.-])\d{3,4}[\s.-]\d{4})(?=$|[^\d.])/g;

  for (const text of rawTexts) {
    if (!text) continue;

    for (const match of text.match(emailRe) ?? []) {
      const lower = match.toLowerCase();
      const [local, domain] = lower.split("@");
      if (!local || !domain) continue;
      if (/^(no-?reply|noreply|donotreply|support@example|user@domain)/.test(lower)) continue;
      const tld = domain.split(".").pop() ?? "";
      if (IGNORED_EMAIL_TLDS.has(tld) || IGNORED_EMAIL_DOMAINS.has(domain)) continue;
      emails.add(lower);
    }

    // Strip URLs and JSON telemetry keys/numbers before searching for phone numbers
    const sanitizedForPhones = text
      .replace(/https?:\/\/[^\s"'<>]+/gi, " ")
      .replace(/"[a-z0-9_]+":\s*-?\d+(?:\.\d+)?/gi, " ");

    let m: RegExpExecArray | null;
    phoneRe.lastIndex = 0;
    while ((m = phoneRe.exec(sanitizedForPhones)) !== null) {
      const candidate = (m[1] ?? "").trim();
      const digits = candidate.replace(/\D/g, "");
      if (digits.length < 10 || digits.length > 15) continue;
      // Avoid matching YYYY-MM-DD or repeated identical digits
      if (/^\d{4}[-.]\d{2}[-.]\d{2}/.test(candidate) || /^(\d)\1+$/.test(digits)) continue;
      phones.add(candidate.replace(/\s+/g, " "));
    }
  }

  return { emails: [...emails], phones: [...phones] };
}

/** Maps a URL to a canonical B2B whitelist profile URL, or returns null to discard it. */
export function canonicalizeB2BProfileUrl(rawUrl: string): {
  platform: B2BSocialPlatform;
  url: string;
  tier: "primary" | "fallback";
} | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const segments = parsed.pathname.split("/").filter(Boolean);

  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    const first = segments[0]?.toLowerCase();
    const second = segments[1];
    if ((first === "in" || first === "company") && second) {
      return {
        platform: "linkedin",
        url: `https://www.linkedin.com/${first}/${second}`,
        tier: "primary",
      };
    }
    return null;
  }

  if (host === "x.com" || host === "twitter.com") {
    const first = segments[0]?.replace(/^@+/, "");
    const reserved = new Set([
      "home",
      "search",
      "explore",
      "i",
      "intent",
      "share",
      "login",
      "signup",
      "tos",
      "privacy",
      "settings",
      "hashtag",
      "notifications",
      "messages",
    ]);
    if (first && !reserved.has(first.toLowerCase()) && /^[a-z0-9_]{1,32}$/i.test(first)) {
      return {
        platform: "twitter",
        url: `https://x.com/${first}`,
        tier: "primary",
      };
    }
    return null;
  }

  if (host === "github.com" || host === "gist.github.com") {
    const first = segments[0];
    const second = segments[1];
    if (!first) return null;
    if (first.toLowerCase() === "sponsors" && second) {
      return {
        platform: "github",
        url: `https://github.com/${second}`,
        tier: "primary",
      };
    }
    const reserved = new Set([
      "features",
      "pricing",
      "orgs",
      "topics",
      "explore",
      "marketplace",
      "sponsors",
      "settings",
      "login",
      "signup",
      "about",
      "security",
      "enterprise",
      "apps",
      "collections",
      "events",
      "trending",
      "search",
    ]);
    if (!reserved.has(first.toLowerCase()) && /^[a-z0-9-]+$/i.test(first)) {
      return {
        platform: "github",
        url: `https://github.com/${first}`,
        tier: "primary",
      };
    }
    return null;
  }

  if (host === "crunchbase.com") {
    const first = segments[0]?.toLowerCase();
    const second = segments[1];
    if ((first === "person" || first === "organization") && second) {
      return {
        platform: "crunchbase",
        url: `https://www.crunchbase.com/${first}/${second}`,
        tier: "primary",
      };
    }
    return null;
  }

  if (host === "wellfound.com" || host === "angel.co") {
    const first = segments[0]?.toLowerCase();
    const second = segments[1];
    if ((first === "u" || first === "company") && second) {
      return {
        platform: "wellfound",
        url: `https://wellfound.com/${first}/${second}`,
        tier: "primary",
      };
    }
    const reserved = new Set(["jobs", "login", "signup", "companies", "recruit", "candidates"]);
    if (first && !reserved.has(first)) {
      return {
        platform: "wellfound",
        url: `https://wellfound.com/u/${segments[0]}`,
        tier: "primary",
      };
    }
    return null;
  }

  if (host === "facebook.com" || host === "fb.com") {
    if (segments[0]?.toLowerCase() === "profile.php" && parsed.searchParams.get("id")) {
      return {
        platform: "facebook",
        url: `https://www.facebook.com/profile.php?id=${parsed.searchParams.get("id")}`,
        tier: "fallback",
      };
    }
    if (segments[0]?.toLowerCase() === "people" && segments[1] && segments[2]) {
      return {
        platform: "facebook",
        url: `https://www.facebook.com/people/${segments[1]}/${segments[2]}`,
        tier: "fallback",
      };
    }
    const first = segments[0];
    const reserved = new Set([
      "login",
      "sharer",
      "share.php",
      "help",
      "policies",
      "privacy",
      "watch",
      "marketplace",
      "groups",
      "events",
      "gaming",
      "pages",
    ]);
    if (first && !reserved.has(first.toLowerCase())) {
      return {
        platform: "facebook",
        url: `https://www.facebook.com/${first}`,
        tier: "fallback",
      };
    }
    return null;
  }

  if (host === "tiktok.com") {
    const first = segments[0];
    if (!first) return null;
    const clean = first.replace(/^@+/, "");
    const reserved = new Set([
      "explore",
      "following",
      "live",
      "upload",
      "login",
      "tag",
      "music",
      "discover",
      "legal",
    ]);
    if (clean && !reserved.has(clean.toLowerCase())) {
      return {
        platform: "tiktok",
        url: `https://www.tiktok.com/@${clean}`,
        tier: "fallback",
      };
    }
    return null;
  }

  if (host === "instagram.com") {
    const first = segments[0]?.replace(/^@+/, "");
    const reserved = new Set([
      "p",
      "reel",
      "reels",
      "stories",
      "explore",
      "accounts",
      "direct",
      "about",
      "developer",
      "legal",
    ]);
    if (first && !reserved.has(first.toLowerCase())) {
      return {
        platform: "instagram",
        url: `https://www.instagram.com/${first}`,
        tier: "fallback",
      };
    }
    return null;
  }

  return null;
}

/**
 * Filters raw OSINT URLs down to the strict B2B domain whitelist, reduces multiple URLs
 * per domain to a single canonical profile URL, and optionally applies the fallback rule
 * (Facebook/TikTok/Instagram only when neither LinkedIn nor X/Twitter is present).
 */
export function filterB2BProfileUrls(
  rawUrls: string[],
  excludeUrls: Array<string | null | undefined> = [],
  options: { applyFallbackRule?: boolean } = {},
): {
  orderedUrls: string[];
  socialProfiles: Partial<Record<B2BSocialPlatform, string>>;
} {
  const excluded = new Set(
    excludeUrls.filter((u): u is string => Boolean(u)).map((u) => urlDedupeKey(u)),
  );
  const byPlatform = new Map<B2BSocialPlatform, string>();

  for (const raw of rawUrls) {
    const canon = canonicalizeB2BProfileUrl(raw);
    if (!canon) continue;
    if (excluded.has(urlDedupeKey(canon.url)) || excluded.has(urlDedupeKey(raw))) continue;
    if (!byPlatform.has(canon.platform)) {
      byPlatform.set(canon.platform, canon.url);
    }
  }

  if (options.applyFallbackRule !== false) {
    const hasHighPriority = byPlatform.has("linkedin") || byPlatform.has("twitter");
    if (hasHighPriority) {
      byPlatform.delete("facebook");
      byPlatform.delete("tiktok");
      byPlatform.delete("instagram");
    }
  }

  const socialProfiles: Partial<Record<B2BSocialPlatform, string>> = {};
  const orderedUrls: string[] = [];
  for (const platform of B2B_PRIORITY_ORDER) {
    const url = byPlatform.get(platform);
    if (url) {
      socialProfiles[platform] = url;
      orderedUrls.push(url);
    }
  }

  return { orderedUrls, socialProfiles };
}

/** Formats validated B2B URLs, emails, and phones into the structured OSINT response. */
export function buildOsintStructuredContacts(input: {
  validatedUrls: string[];
  emails: string[];
  phones?: string[];
  excludeUrls?: Array<string | null | undefined>;
}): OsintStructuredContacts {
  const { socialProfiles } = filterB2BProfileUrls(input.validatedUrls, input.excludeUrls ?? [], {
    applyFallbackRule: true,
  });

  const emails = [...new Set(input.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const phones = [...new Set((input.phones ?? []).map((p) => p.trim()).filter(Boolean))];
  const hasWhitelistProfiles = Object.keys(socialProfiles).length > 0;

  return {
    emails,
    social_profiles: socialProfiles,
    other_contacts: hasWhitelistProfiles ? [] : phones,
  };
}

/** Normalizes stored `osint_contacts` (structured object or legacy URL array) for the UI. */
export function normalizeStoredOsintContacts(raw: unknown): OsintStructuredContacts {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const rec = raw as Record<string, unknown>;
    const rawEmails = Array.isArray(rec["emails"])
      ? rec["emails"].filter((x): x is string => typeof x === "string")
      : [];
    const rawOther = Array.isArray(rec["other_contacts"])
      ? rec["other_contacts"].filter((x): x is string => typeof x === "string")
      : [];
    const rawProfilesObj =
      rec["social_profiles"] &&
      typeof rec["social_profiles"] === "object" &&
      !Array.isArray(rec["social_profiles"])
        ? (rec["social_profiles"] as Record<string, unknown>)
        : {};
    const profileUrls = Object.values(rawProfilesObj).filter(
      (x): x is string => typeof x === "string",
    );

    const { socialProfiles } = filterB2BProfileUrls(profileUrls, [], { applyFallbackRule: true });
    const hasProfiles = Object.keys(socialProfiles).length > 0;
    // Only keep phone-like / non-URL fallback contacts (never personal websites or random URLs)
    const safeOther = hasProfiles ? [] : rawOther.filter((c) => !/^https?:\/\//i.test(c.trim()));

    return {
      emails: [...new Set(rawEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))],
      social_profiles: socialProfiles,
      other_contacts: safeOther,
    };
  }

  if (Array.isArray(raw)) {
    const strings = raw.filter((x): x is string => typeof x === "string");
    const emails = strings.filter((s) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(s.trim()));
    const { socialProfiles } = filterB2BProfileUrls(strings, [], { applyFallbackRule: true });
    return {
      emails: [...new Set(emails.map((e) => e.toLowerCase()))],
      social_profiles: socialProfiles,
      other_contacts: [],
    };
  }

  return { emails: [], social_profiles: {}, other_contacts: [] };
}

export interface FormattedOsintContact {
  label: string;
  href: string;
  raw: string;
  kind: "email" | "url";
}

const DOMAIN_LABELS: Array<[RegExp, string]> = [
  [/linkedin\.com$/i, "LinkedIn Profile"],
  [/(?:twitter\.com|x\.com)$/i, "X Profile"],
  [/github\.com$/i, "GitHub Profile"],
  [/crunchbase\.com$/i, "Crunchbase Profile"],
  [/(?:wellfound\.com|angel\.co)$/i, "Wellfound Profile"],
  [/facebook\.com$/i, "Facebook Profile"],
  [/tiktok\.com$/i, "TikTok Profile"],
  [/instagram\.com$/i, "Instagram Profile"],
];

export function formatOsintContact(entry: unknown): FormattedOsintContact | null {
  const raw =
    typeof entry === "string"
      ? entry.trim()
      : entry && typeof entry === "object" && "url" in entry && typeof entry.url === "string"
        ? entry.url.trim()
        : entry && typeof entry === "object" && "value" in entry && typeof entry.value === "string"
          ? entry.value.trim()
          : "";

  if (!raw) return null;

  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(raw)) {
    return { label: `Email: ${raw}`, href: `mailto:${raw}`, raw, kind: "email" };
  }

  const canon = canonicalizeB2BProfileUrl(raw);
  if (!canon) return null;

  try {
    const parsed = new URL(canon.url);
    const host = parsed.hostname.replace(/^www\./i, "");
    const matched = DOMAIN_LABELS.find(([re]) => re.test(host));
    if (!matched) return null;
    return { label: matched[1], href: parsed.toString(), raw: canon.url, kind: "url" };
  } catch {
    return null;
  }
}

export interface CsvLeadInput {
  reviewer_name: string | null;
  competitor_name: string;
  source_platform: string;
  sentiment_score: number;
  extracted_complaint: string | null;
  date_scraped: string;
  email: string | null;
  linkedin_url: string | null;
  reviewer_profile_url: string | null;
  source_url: string;
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Converts filtered leads into an RFC-4180 CSV string with required outreach columns. */
export function leadsToCsv(leads: CsvLeadInput[]): string {
  const headers = [
    "Reviewer Name",
    "Competitor",
    "Platform",
    "Frustration Score",
    "Complaint",
    "Date",
    "Contact URL/Email",
  ];

  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const l of leads) {
    const contact =
      l.email && (l.linkedin_url || l.reviewer_profile_url || l.source_url)
        ? `${l.email} | ${l.linkedin_url || l.reviewer_profile_url || l.source_url}`
        : l.email || l.linkedin_url || l.reviewer_profile_url || l.source_url || "";

    const score = Number.isFinite(l.sentiment_score) ? l.sentiment_score : "";
    lines.push(
      [
        l.reviewer_name ?? "",
        l.competitor_name,
        platformLabel(l.source_platform),
        score,
        l.extracted_complaint ?? "",
        l.date_scraped,
        contact,
      ]
        .map(escapeCsvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

export type BrandSentiment = "positive" | "neutral" | "negative";

export interface BrandMention {
  id: string;
  platform: string;
  author: string | null;
  author_url: string | null;
  source_url: string;
  text: string;
  sentiment_score: number; // -10 (very negative) to +10 (very positive)
  sentiment: BrandSentiment;
  summary: string;
  published_at: string;
  scraped_at: string;
}

export interface BrandBaselineProgress {
  completed_platforms: number;
  total_platforms: number;
  mentions_found: number;
}

export interface AiBrandInsights {
  positive_hypotheses: string[];
  negative_hypotheses: string[];
  generated_at: string;
}

export interface BrandListeningState {
  company_name: string | null;
  company_url: string | null;
  last_scraped_at: string | null;
  has_completed_brand_baseline: boolean;
  baseline_running: boolean;
  baseline_error: string | null;
  baseline_progress: BrandBaselineProgress | null;
  mentions: BrandMention[];
  recommendations: string[];
  recommendations_generated_at: string | null;
  recommendations_mention_count: number;
  ai_brand_insights: AiBrandInsights | null;
}

export const BRAND_BASELINE_48H_EXCEPTION_EMAIL = "boosted688@gmail.com";

/** Determines whether Brand Listening should restrict scraped posts to the last 48 hours. */
export function shouldApply48HourBrandFilter(user: {
  has_completed_brand_baseline: boolean;
  email?: string | null;
}): boolean {
  let apply48HourFilter = true;

  if (user.has_completed_brand_baseline === false) {
    // First run baseline
    apply48HourFilter = false;

    // THE EXCEPTION
    if ((user.email ?? "").trim().toLowerCase() === BRAND_BASELINE_48H_EXCEPTION_EMAIL) {
      apply48HourFilter = true;
    }
  }

  return apply48HourFilter;
}

export function emptyBrandListeningState(
  company_name: string | null = null,
  company_url: string | null = null,
  has_completed_brand_baseline = false,
): BrandListeningState {
  return {
    company_name,
    company_url,
    last_scraped_at: null,
    has_completed_brand_baseline,
    baseline_running: false,
    baseline_error: null,
    baseline_progress: null,
    mentions: [],
    recommendations: [],
    recommendations_generated_at: null,
    recommendations_mention_count: 0,
    ai_brand_insights: null,
  };
}

/** Clamps own-brand sentiment score to [-10, +10] and derives sentiment bucket. */
export function normalizeBrandSentiment(
  rawScore: unknown,
  rawLabel?: unknown,
): { score: number; sentiment: BrandSentiment } {
  const num = Number(rawScore);
  const clamped = Number.isFinite(num) ? Math.max(-10, Math.min(10, Math.round(num))) : 0;

  if (clamped >= 2) return { score: clamped, sentiment: "positive" };
  if (clamped <= -2) return { score: clamped, sentiment: "negative" };
  if (clamped === 0 && typeof rawLabel === "string") {
    const lower = rawLabel.trim().toLowerCase();
    if (lower === "positive") return { score: 2, sentiment: "positive" };
    if (lower === "negative") return { score: -2, sentiment: "negative" };
  }
  return { score: clamped, sentiment: "neutral" };
}

/** Merges & deduplicates own-brand mentions by source_url, newest first. */
export function mergeBrandMentions(
  existing: BrandMention[],
  incoming: BrandMention[],
  limit = 250,
): BrandMention[] {
  const byUrl = new Map<string, BrandMention>();
  for (const item of existing) {
    if (!item?.source_url) continue;
    byUrl.set(urlDedupeKey(item.source_url), item);
  }
  for (const item of incoming) {
    if (!item?.source_url) continue;
    byUrl.set(urlDedupeKey(item.source_url), item);
  }

  return [...byUrl.values()]
    .sort((a, b) => {
      const ta = new Date(a.published_at || a.scraped_at).getTime() || 0;
      const tb = new Date(b.published_at || b.scraped_at).getTime() || 0;
      return tb - ta;
    })
    .slice(0, limit);
}

/** Computes chart and feedback list summaries from stored brand mentions. */
export function summarizeBrandMentions(mentions: BrandMention[]) {
  let positive = 0;
  let neutral = 0;
  let negative = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  const platformCounts = new Map<string, number>();

  for (const m of mentions) {
    if (m.sentiment === "positive") positive++;
    else if (m.sentiment === "negative") negative++;
    else neutral++;

    if (Number.isFinite(m.sentiment_score)) {
      scoreSum += m.sentiment_score;
      scoreCount++;
    }

    const p = m.platform || "other";
    platformCounts.set(p, (platformCounts.get(p) ?? 0) + 1);
  }

  const total = mentions.length;
  const sentimentBreakdown = [
    { name: "Positive", key: "positive" as const, value: positive, color: "#16A34A" },
    { name: "Neutral", key: "neutral" as const, value: neutral, color: "#64748B" },
    { name: "Negative", key: "negative" as const, value: negative, color: "#DC2626" },
  ];

  const byPlatform = [...platformCounts.entries()]
    .map(([platform, count]) => ({
      platform,
      name: platformLabel(platform),
      mentions: count,
    }))
    .sort((a, b) => b.mentions - a.mentions);

  const topPositive = mentions
    .filter((m) => m.sentiment === "positive")
    .sort(
      (a, b) =>
        b.sentiment_score - a.sentiment_score || b.published_at.localeCompare(a.published_at),
    );

  const topNegative = mentions
    .filter((m) => m.sentiment === "negative")
    .sort(
      (a, b) =>
        a.sentiment_score - b.sentiment_score || b.published_at.localeCompare(a.published_at),
    );

  return {
    total,
    positive,
    neutral,
    negative,
    positiveShare: total > 0 ? Math.round((positive / total) * 100) : null,
    avgScore: scoreCount > 0 ? Number((scoreSum / scoreCount).toFixed(1)) : null,
    sentimentBreakdown,
    byPlatform,
    topPositive,
    topNegative,
  };
}

export interface ScoredReviewItem {
  index: number;
  relevant: boolean;
  score: number;
  sentiment: "negative" | "neutral" | "positive";
  negative_quote: string;
  complaint: string;
  pitch: string;
  job_title: string | null;
  company: string | null;
  is_person: boolean;
}

/**
 * Normalizes Gemini review-scoring JSON regardless of whether the model returns
 * `{ results: [...] }`, `[...]`, `{ items: [...] }`, or stringified index/score/boolean fields.
 */
export function extractScoredReviews(rawOutput: unknown, batchLength: number): ScoredReviewItem[] {
  const list = Array.isArray(rawOutput)
    ? rawOutput
    : rawOutput && typeof rawOutput === "object"
      ? (() => {
          const obj = rawOutput as Record<string, unknown>;
          for (const key of ["results", "items", "posts", "reviews", "data"]) {
            if (Array.isArray(obj[key])) return obj[key] as unknown[];
          }
          return [];
        })()
      : [];

  const seen = new Set<number>();
  const out: ScoredReviewItem[] = [];

  for (let pos = 0; pos < list.length; pos++) {
    const entry = list[pos];
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;

    const rawIdx = rec["index"];
    const idx =
      typeof rawIdx === "number"
        ? rawIdx
        : typeof rawIdx === "string" && rawIdx.trim() !== ""
          ? Number(rawIdx.replace(/[^\d-]/g, ""))
          : list.length === batchLength
            ? pos
            : Number.NaN;

    if (!Number.isInteger(idx) || idx < 0 || idx >= batchLength || seen.has(idx)) continue;
    seen.add(idx);

    const rawRel = rec["relevant"];
    const relevant =
      typeof rawRel === "boolean"
        ? rawRel
        : typeof rawRel === "string"
          ? rawRel.trim().toLowerCase() === "true"
          : false;

    const rawSent =
      typeof rec["sentiment"] === "string" ? rec["sentiment"].trim().toLowerCase() : "";
    const sentiment: "negative" | "neutral" | "positive" =
      rawSent === "negative" || rawSent === "positive" || rawSent === "neutral"
        ? rawSent
        : "neutral";

    const rawScore = Number(rec["score"]);
    const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(10, rawScore)) : 0;

    const rawIsPerson = rec["is_person"];
    const is_person =
      typeof rawIsPerson === "boolean"
        ? rawIsPerson
        : typeof rawIsPerson === "string"
          ? rawIsPerson.trim().toLowerCase() !== "false"
          : true;

    const cleanStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const cleanOptStr = (v: unknown) => {
      const s = cleanStr(v);
      return s && s.toLowerCase() !== "null" ? s : null;
    };

    out.push({
      index: idx,
      relevant,
      score,
      sentiment,
      negative_quote: cleanStr(rec["negative_quote"]),
      complaint: cleanStr(rec["complaint"]),
      pitch: cleanStr(rec["pitch"]),
      job_title: cleanOptStr(rec["job_title"]),
      company: cleanOptStr(rec["company"]),
      is_person,
    });
  }

  return out;
}

export function formatUtcHour(h: number): string {
  const d = new Date();
  d.setUTCHours(h, 0, 0, 0);
  return `${d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })} (UTC)`;
}

export function formatLocalHour(h: number): string {
  const d = new Date();
  d.setUTCHours(h, 0, 0, 0);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export interface ScrapeStatusStatsView {
  found: number;
  relevant: number;
  analyzed: number;
  saved: number;
  emails: number;
  linkedin: number;
  social: number;
  discarded: number;
}

export interface ScrapeStatusSnapshot {
  job_id: string;
  job_status: "idle" | "running" | "completed";
  current_competitor_index: number;
  total_competitors: number;
  current_competitor_name: string | null;
  step: "idle" | "fetching" | "analyzing" | "done";
  stats: ScrapeStatusStatsView;
  sources?: Array<{ platform: string; status: string; count: number }>;
  errors?: string[];
  competitor_names?: string[];
}

export interface FirstRunProgressMetrics {
  processedCompetitors: number;
  totalCompetitors: number;
  progressPercent: number;
  totalPostsFound: number;
  leadsSaved: number;
  discarded: number;
  canViewDashboard: boolean;
  isComplete: boolean;
  earlyUnlockReady: boolean;
}

export interface FirstRunLogEntry {
  id: string;
  timestamp: string;
  message: string;
  tone: "info" | "success" | "warn";
}

export function computeFirstRunProgress(
  status: ScrapeStatusSnapshot,
  fallbackTotal = 1,
  elapsedSeconds = 0,
  hasStartError = false,
): FirstRunProgressMetrics {
  const totalCompetitors = Math.max(1, status.total_competitors || fallbackTotal);
  const isComplete = status.job_status === "completed";
  const processedCompetitors = isComplete
    ? totalCompetitors
    : Math.min(totalCompetitors, Math.max(0, status.current_competitor_index));

  const rawPercent = Math.round((processedCompetitors / totalCompetitors) * 100);
  const progressPercent = isComplete
    ? 100
    : Math.min(99, Math.max(status.job_status === "running" ? 4 : 0, rawPercent));

  const earlyUnlockReady = !isComplete && processedCompetitors >= 3;
  const canViewDashboard =
    isComplete || processedCompetitors >= 3 || elapsedSeconds >= 90 || hasStartError;

  return {
    processedCompetitors,
    totalCompetitors,
    progressPercent,
    totalPostsFound: Math.max(0, status.stats.found ?? 0),
    leadsSaved: Math.max(0, status.stats.saved ?? 0),
    discarded: Math.max(0, status.stats.discarded ?? 0),
    canViewDashboard,
    isComplete,
    earlyUnlockReady,
  };
}

export function diffScrapeStatusLogs(
  prev: ScrapeStatusSnapshot | null,
  next: ScrapeStatusSnapshot,
  now: Date = new Date(),
  sequenceSeed = 0,
): FirstRunLogEntry[] {
  const timestamp = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const total = Math.max(1, next.total_competitors || 1);
  const entries: FirstRunLogEntry[] = [];
  let seq = sequenceSeed;

  const push = (message: string, tone: FirstRunLogEntry["tone"] = "info") => {
    entries.push({
      id: `${now.getTime()}-${seq++}`,
      timestamp,
      message,
      tone,
    });
  };

  if (!prev) {
    if (next.job_status === "completed") {
      push(
        `Scan complete! Saved ${next.stats.saved} qualified lead${next.stats.saved === 1 ? "" : "s"} from ${next.stats.found} post${next.stats.found === 1 ? "" : "s"}.`,
        "success",
      );
    } else if (next.current_competitor_name) {
      push(
        `Scanning ${next.current_competitor_name} (${Math.min(next.current_competitor_index + 1, total)}/${total}) across social & review platforms...`,
      );
    } else {
      push(`Initializing scan across ${total} competitor${total === 1 ? "" : "s"}...`);
    }
    return entries;
  }

  const targetName = next.current_competitor_name ?? prev.current_competitor_name ?? "competitors";

  if (next.stats.found > prev.stats.found) {
    const deltaFound = next.stats.found - prev.stats.found;
    push(
      `Found ${deltaFound} post${deltaFound === 1 ? "" : "s"} about ${targetName} (${next.stats.found} total scanned)`,
    );
  }

  if (
    next.step === "analyzing" &&
    (prev.step !== "analyzing" || prev.current_competitor_index !== next.current_competitor_index)
  ) {
    push(`Gemini analyzing ${targetName} mentions for frustration & buying signals...`);
  }

  if (next.stats.saved > prev.stats.saved) {
    const deltaSaved = next.stats.saved - prev.stats.saved;
    push(`Qualified lead saved! (+${deltaSaved} new · ${next.stats.saved} total saved)`, "success");
  }

  if (next.stats.discarded > prev.stats.discarded) {
    const deltaDiscarded = next.stats.discarded - prev.stats.discarded;
    push(
      `Filtered out ${deltaDiscarded} non-lead post${deltaDiscarded === 1 ? "" : "s"} (${next.stats.discarded} discarded)`,
    );
  }

  const deltaEmails = Math.max(0, next.stats.emails - prev.stats.emails);
  const deltaLinkedin = Math.max(0, next.stats.linkedin - prev.stats.linkedin);
  if (deltaEmails > 0 || deltaLinkedin > 0) {
    const foundParts = [
      deltaEmails > 0 ? `${deltaEmails} email${deltaEmails === 1 ? "" : "s"}` : "",
      deltaLinkedin > 0 ? `${deltaLinkedin} LinkedIn profile${deltaLinkedin === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    push(`Contact enrichment discovered ${foundParts.join(" and ")}.`, "success");
  }

  if (
    next.current_competitor_index >= 3 &&
    prev.current_competitor_index < 3 &&
    next.job_status === "running"
  ) {
    push("3 competitors processed — View Dashboard is now unlocked!", "success");
  }

  if (
    next.job_status === "running" &&
    next.current_competitor_name &&
    (next.current_competitor_name !== prev.current_competitor_name ||
      next.current_competitor_index !== prev.current_competitor_index)
  ) {
    push(
      `Now scanning ${next.current_competitor_name} (${Math.min(next.current_competitor_index + 1, total)}/${total})...`,
    );
  }

  const prevErrors = prev.errors?.length ?? 0;
  const nextErrors = next.errors?.length ?? 0;
  if (nextErrors > prevErrors && next.errors) {
    for (const err of next.errors.slice(prevErrors)) {
      push(`Note: ${err}`, "warn");
    }
  }

  if (next.job_status === "completed" && prev.job_status !== "completed") {
    push(
      `First scan complete! Saved ${next.stats.saved} qualified lead${next.stats.saved === 1 ? "" : "s"} from ${next.stats.found} scanned posts.`,
      "success",
    );
  }

  return entries;
}

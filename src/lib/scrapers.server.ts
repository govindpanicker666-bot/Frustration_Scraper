import { execFile } from "node:child_process";
import { join } from "node:path";
import {
  exactQuery,
  isRecent,
  keepReview,
  slugify,
  stripHtml,
  type Platform,
  type RawReview,
} from "./pipeline";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export interface CompetitorCtx {
  name: string;
  domain: string | null;
}
export interface ScrapePlatformOptions {
  apply48HourFilter?: boolean;
  intent?: "complaints" | "mentions";
}
export type SourceStatus = "ok" | "blocked" | "no_match" | "no_key";
export interface SourceResult {
  status: SourceStatus;
  reviews: RawReview[];
}

class Blocked extends Error {}
class NoMatch extends Error {}

async function get(url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": BROWSER_UA,
      "Accept-Language": "en-US,en;q=0.9",
      ...(init.headers ?? {}),
    },
  });
  if (r.status === 403 || r.status === 429 || r.status === 503)
    throw new Blocked(`${url} ${r.status}`);
  return r;
}
async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await get(url, {
    ...init,
    headers: { Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Blocked(`${url} ${r.status}`);
  return (await r.json()) as T;
}
const iso = (v: unknown) => {
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
};
const since48 = () => Math.floor(Date.now() / 1000) - 48 * 3600;

const MAX_DATE_LOOKUPS_PER_PLATFORM = 20;

/** Parse dates from a search snippet without pretending an unknown date is current. */
export function parseSnippetDate(snippet: string): string {
  const text = stripHtml(snippet).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const relative =
    text.match(
      /^\s*(?:(?:published|posted|created|uploaded|updated)\s*(?:on|at|:)?\s*)?(?:about\s+)?(\d{1,4})\s+(minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i,
    ) ??
    text.match(
      /[|·•–—]\s*(?:(?:published|posted|created|uploaded|updated)\s*(?:on|at|:)?\s*)?(?:about\s+)?(\d{1,4})\s+(minutes?|hours?|days?|weeks?|months?|years?)\s+ago\b/i,
    );
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2]!.toLowerCase().replace(/s$/, "");
    const unitMs =
      unit === "minute"
        ? 60_000
        : unit === "hour"
          ? 3_600_000
          : unit === "day"
            ? 86_400_000
            : unit === "week"
              ? 7 * 86_400_000
              : unit === "month"
                ? 30 * 86_400_000
                : 365 * 86_400_000;
    // Search engines round relative day labels. Bias "2 days ago" slightly older
    // so an uncertain date is not accidentally admitted past the 48-hour boundary.
    const conservativeOffset = unit === "day" && amount >= 2 ? 12 * 3_600_000 : 0;
    return new Date(Date.now() - amount * unitMs - conservativeOffset).toISOString();
  }
  const datePrefix =
    text.match(
      /^\s*(?:(?:published|posted|created|uploaded|updated)\s*(?:on|at|:)?\s*)?(just now|moments ago|yesterday|today|\d+\s+seconds? ago)\b/i,
    )?.[1] ?? "";
  if (/^(?:just now|moments ago|today|\d+\s+seconds? ago)$/i.test(datePrefix)) {
    return new Date().toISOString();
  }
  if (/^yesterday$/i.test(datePrefix)) {
    return new Date(Date.now() - 24 * 3_600_000).toISOString();
  }
  const dateLead =
    text.match(
      /^\s*(?:(?:published|posted|created|uploaded|updated)\s*(?:on|at|:)?\s*)?((?:20\d{2}-\d{1,2}-\d{1,2}(?:[T ][0-9:.Z+-]+)?)|(?:[A-Z][a-z]{2,8}\s+\d{1,2}(?:,?\s+20\d{2})?))/i,
    )?.[1] ?? "";
  const isoMatch = dateLead.match(/\b20\d{2}-\d{1,2}-\d{1,2}(?:[T ][0-9:.Z+-]+)?\b/);
  if (isoMatch) {
    const parsed = iso(isoMatch[0]);
    if (parsed) return parsed;
  }
  const monthNames =
    "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
  const monthFirst = dateLead.match(
    new RegExp("^(" + monthNames + ")\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?$", "i"),
  );
  const dayFirst = dateLead.match(
    new RegExp("^(\\d{1,2})\\s+(" + monthNames + ")(?:\\s+(20\\d{2}))?$", "i"),
  );
  const dateMatch = monthFirst ?? dayFirst;
  if (dateMatch) {
    const year = Number(dateMatch[3] ?? new Date().getUTCFullYear());
    const dateText = monthFirst
      ? dateMatch[1] + " " + dateMatch[2] + ", " + year
      : dateMatch[2] + " " + dateMatch[1] + ", " + year;
    const parsed = iso(dateText);
    if (parsed) {
      if (!dateMatch[3] && new Date(parsed).getTime() > Date.now() + 24 * 3_600_000) {
        const priorYear = new Date(dateText);
        priorYear.setFullYear(priorYear.getFullYear() - 1);
        return priorYear.toISOString();
      }
      return parsed;
    }
  }
  return "";
}

function normalizePublishedDate(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) return "";
    const date = new Date(value < 1e12 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return "";
  const trimmed = value.trim();
  if (/^\d{10,13}$/.test(trimmed)) return normalizePublishedDate(Number(trimmed));
  return iso(trimmed) || parseSnippetDate(trimmed);
}

function inferPublishedDateFromUrl(sourceUrl: string): string {
  // X/Twitter Snowflake IDs encode the post creation timestamp.
  const match = sourceUrl.match(/(?:x|twitter)\.com\/[^/?#]+\/status\/(\d+)/i);
  if (match) {
    try {
      const milliseconds = Number((BigInt(match[1]!) >> 22n) + 1_288_834_657_657n);
      const date = new Date(milliseconds);
      if (Number.isFinite(milliseconds) && !Number.isNaN(date.getTime())) return date.toISOString();
    } catch {
      /* ignore malformed IDs */
    }
  }
  return "";
}

function dateFromHtml(html: string): string {
  const readAttribute = (tag: string, attribute: string) =>
    tag.match(new RegExp("\\b" + attribute + "\\s*=\\s*[\\\"']([^\\\"']+)[\\\"']", "i"))?.[1] ?? "";
  const publishedMetaNames = new Set([
    "article:published_time",
    "og:published_time",
    "datepublished",
    "date_published",
    "publishdate",
    "publish_date",
    "dc.date",
    "date",
  ]);
  for (const tag of html.match(/<(?:meta|time)\b[^>]*>/gi) ?? []) {
    if (/^<time\b/i.test(tag)) {
      const date = normalizePublishedDate(readAttribute(tag, "datetime"));
      if (date) return date;
      continue;
    }
    const name = (
      readAttribute(tag, "property") ||
      readAttribute(tag, "name") ||
      readAttribute(tag, "itemprop")
    ).toLowerCase();
    if (!publishedMetaNames.has(name)) continue;
    const date = normalizePublishedDate(
      readAttribute(tag, "content") || readAttribute(tag, "datetime"),
    );
    if (date) return date;
  }
  const visitJsonLd = (node: unknown): string => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = visitJsonLd(child);
        if (found) return found;
      }
      return "";
    }
    if (!node || typeof node !== "object") return "";
    const record = node as Record<string, unknown>;
    for (const key of [
      "datePublished",
      "dateCreated",
      "uploadDate",
      "publishedAt",
      "published_at",
    ]) {
      const date = normalizePublishedDate(record[key]);
      if (date) return date;
    }
    for (const child of Object.values(record)) {
      const found = visitJsonLd(child);
      if (found) return found;
    }
    return "";
  };
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const found = visitJsonLd(JSON.parse(match[1]!));
      if (found) return found;
    } catch {
      /* skip malformed JSON-LD */
    }
  }
  return "";
}

const DATE_LOOKUP_HOSTS = [
  "x.com",
  "twitter.com",
  "linkedin.com",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "fb.watch",
  "t.me",
  "pinterest.com",
  "threads.net",
  "bsky.app",
  "mastodon.social",
  "reddit.com",
  "news.ycombinator.com",
  "producthunt.com",
  "trustpilot.com",
  "capterra.com",
  "g2.com",
  "apps.apple.com",
  "itunes.apple.com",
  "play.google.com",
  "dev.to",
  "stackoverflow.com",
  "stackexchange.com",
  "complaintsboard.com",
  "github.com",
  "lemmy.world",
  "medium.com",
  "alternativeto.net",
  "quora.com",
  "sitejabber.com",
  "trustradius.com",
  "bbb.org",
  "canny.io",
  "featurebase.app",
  "upvoty.com",
  "discourse.org",
];

function isAllowedDateLookupHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return DATE_LOOKUP_HOSTS.some((allowed) => host === allowed || host.endsWith("." + allowed));
}

async function fetchPublishedDateFromUrl(sourceUrl: string): Promise<string> {
  const inferred = inferPublishedDateFromUrl(sourceUrl);
  if (inferred) return inferred;

  try {
    let url = new URL(sourceUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (url.port !== "" && url.port !== "80" && url.port !== "443") ||
      url.username ||
      url.password ||
      !isAllowedDateLookupHost(url.hostname)
    )
      return "";

    // Follow only a small number of redirects and re-check every destination host.
    for (let redirectCount = 0; redirectCount <= 2; redirectCount++) {
      const response = await fetch(url.toString(), {
        headers: { "User-Agent": BROWSER_UA, "Accept-Language": "en-US,en;q=0.9" },
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirectCount === 2) return "";
        const nextUrl = new URL(location, url);
        if (!isAllowedDateLookupHost(nextUrl.hostname)) return "";
        url = nextUrl;
        continue;
      }
      if (!response.ok) return "";
      return dateFromHtml((await response.text()).slice(0, 1_500_000));
    }
  } catch {
    return "";
  }
  return "";
}
async function recoverMissingPublishedDates(reviews: RawReview[]): Promise<RawReview[]> {
  const normalized = reviews.map((review) => ({
    ...review,
    published_at: normalizePublishedDate(review.published_at),
  }));
  const missingIndexes = normalized
    .map((review, index) => (!review.published_at ? index : -1))
    .filter((index) => index >= 0)
    .slice(0, MAX_DATE_LOOKUPS_PER_PLATFORM);
  const recovered = await Promise.all(
    missingIndexes.map(async (index) => ({
      index,
      date: await fetchPublishedDateFromUrl(normalized[index]!.source_url),
    })),
  );
  for (const item of recovered) {
    if (item.date) normalized[item.index]!.published_at = item.date;
  }
  return normalized;
}

// ---------- Hacker News ----------
interface HnResp {
  hits: {
    author: string;
    comment_text?: string;
    story_title?: string;
    created_at_i: number;
    objectID: string;
  }[];
}
async function hackernews(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  const endpoint = apply48HourFilter
    ? `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(exactQuery(c.name))}&tags=comment&numericFilters=created_at_i>${since48()}&hitsPerPage=50&advancedSyntax=true`
    : `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(exactQuery(c.name))}&tags=comment&hitsPerPage=100&advancedSyntax=true`;
  const j = await getJson<HnResp>(endpoint);
  return j.hits.map((h): RawReview => ({
    platform: "hackernews",
    reviewer_name: h.author,
    reviewer_profile_url: `https://news.ycombinator.com/user?id=${h.author}`,
    source_url: `https://news.ycombinator.com/item?id=${h.objectID}`,
    text: `${h.story_title ? `[Thread: ${h.story_title}] ` : ""}${stripHtml(h.comment_text ?? "")}`.slice(
      0,
      3000,
    ),
    published_at: new Date(h.created_at_i * 1000).toISOString(),
  }));
}

// ---------- Product Hunt ----------
async function phToken(): Promise<string> {
  const id = process.env["PRODUCTHUNT_API_KEY"],
    secret = process.env["PRODUCTHUNT_API_SECRET"];
  if (!id || !secret) throw new Error("no_key");
  const r = await fetch("https://api.producthunt.com/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: id,
      client_secret: secret,
      grant_type: "client_credentials",
    }),
  });
  if (!r.ok) throw new Blocked(`PH token ${r.status}`);
  return ((await r.json()) as { access_token: string }).access_token;
}
async function producthunt(c: CompetitorCtx) {
  const token = await phToken();
  const q = `query($slug:String!){post(slug:$slug){name website url comments(first:50,order:NEWEST){edges{node{id body createdAt url user{name username}}}}}}`;
  const candidates = [slugify(c.name), c.domain ? slugify(c.domain.split(".")[0]!) : null].filter(
    Boolean,
  ) as string[];
  for (const slug of [...new Set(candidates)]) {
    const r = await fetch("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: q, variables: { slug } }),
    });
    if (!r.ok) throw new Blocked(`PH ${r.status}`);
    type N = {
      id: string;
      body: string;
      createdAt: string;
      url: string;
      user: { name: string; username: string };
    };
    const j = (await r.json()) as {
      data?: {
        post?: { website?: string; url: string; comments: { edges: { node: N }[] } } | null;
      };
    };
    const post = j.data?.post;
    if (!post) continue;
    if (c.domain && post.website && !post.website.includes(c.domain.split(".")[0]!)) {
      // Product Hunt wraps websites in redirect links; only reject when it clearly points elsewhere.
      if (!/producthunt\.com/.test(post.website)) continue;
    }
    return post.comments.edges.map(({ node: n }): RawReview => ({
      platform: "producthunt",
      reviewer_name: n.user?.name ?? null,
      reviewer_profile_url: n.user?.username
        ? `https://www.producthunt.com/@${n.user.username}`
        : null,
      source_url: n.url || `${post.url}#comment-${n.id}`,
      text: stripHtml(n.body ?? ""),
      published_at: iso(n.createdAt),
    }));
  }
  throw new NoMatch("no PH post");
}

// ---------- Trustpilot ----------
async function trustpilot(c: CompetitorCtx) {
  if (!c.domain) throw new NoMatch("no domain");
  const r = await get(`https://www.trustpilot.com/review/${c.domain}?sort=recency`);
  if (r.status === 404) throw new NoMatch("not on trustpilot");
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Blocked("trustpilot no data");
  type TR = {
    id: string;
    title: string;
    text: string;
    consumer?: { displayName?: string; id?: string };
    dates?: { publishedDate?: string };
  };
  const reviews =
    (JSON.parse(m[1]!) as { props?: { pageProps?: { reviews?: TR[] } } }).props?.pageProps
      ?.reviews ?? [];
  return reviews.map((t): RawReview => ({
    platform: "trustpilot",
    reviewer_name: t.consumer?.displayName ?? null,
    reviewer_profile_url: t.consumer?.id
      ? `https://www.trustpilot.com/users/${t.consumer.id}`
      : null,
    source_url: `https://www.trustpilot.com/reviews/${t.id}`,
    text: `${t.title}. ${t.text}`,
    published_at: iso(t.dates?.publishedDate),
  }));
}

// ---------- JSON-LD review pages (Capterra / G2) ----------
function jsonLdReviews(html: string, platform: Platform, pageUrl: string): RawReview[] {
  const out: RawReview[] = [];
  for (const m of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) {
          n.forEach(walk);
          return;
        }
        if (!n || typeof n !== "object") return;
        const o = n as Record<string, unknown>;
        if (o["@type"] === "Review") {
          const a = o["author"] as { name?: string } | undefined;
          out.push({
            platform,
            reviewer_name: a?.name ?? null,
            reviewer_profile_url: null,
            source_url: `${pageUrl}#${slugify(String(o["name"] ?? a?.name ?? out.length))}`,
            text: stripHtml(`${o["name"] ?? ""}. ${o["reviewBody"] ?? o["description"] ?? ""}`),
            published_at: iso(o["datePublished"]),
          });
        }
        Object.values(o).forEach(walk);
      };
      walk(JSON.parse(m[1]!));
    } catch {
      /* skip bad block */
    }
  }
  return out;
}
async function ddgFirst(query: string, mustContain: RegExp): Promise<string | null> {
  const { ddgResults } = await import("./enrich.server");
  return (await ddgResults(query)).find((x) => mustContain.test(x.url))?.url ?? null;
}
async function capterra(c: CompetitorCtx) {
  const url = await ddgFirst(
    `${c.name} reviews site:capterra.com`,
    /capterra\.com\/p\/\d+\/[^/]+\/reviews/,
  );
  if (!url) throw new NoMatch("no capterra page");
  const r = await get(url);
  if (!r.ok) throw new Blocked(`capterra ${r.status}`);
  return jsonLdReviews(await r.text(), "capterra", url);
}
async function g2(c: CompetitorCtx) {
  const r = await get(`https://www.g2.com/products/${slugify(c.name)}/reviews`);
  if (r.status === 404) throw new NoMatch("not on g2");
  if (!r.ok) throw new Blocked(`g2 ${r.status}`);
  const html = await r.text();
  if (/cf-chl|captcha/i.test(html)) throw new Blocked("g2 captcha");
  return jsonLdReviews(html, "g2", r.url);
}

// ---------- App Store ----------
interface ItunesSearch {
  results: { trackId: number; trackName: string; sellerUrl?: string; sellerName?: string }[];
}
async function appstore(c: CompetitorCtx) {
  const s = await getJson<ItunesSearch>(
    `https://itunes.apple.com/search?term=${encodeURIComponent(c.name)}&entity=software&limit=10`,
  );
  const base = c.domain?.split(".")[0] ?? "";
  const app =
    s.results.find((r) => base && (r.sellerUrl ?? "").includes(base)) ??
    s.results.find(
      (r) => r.trackName.toLowerCase().split(/[\s:–-]/)[0] === c.name.toLowerCase().split(/\s/)[0],
    );
  if (!app) throw new NoMatch("no matching app");
  type E = {
    author: { name: { label: string } };
    title: { label: string };
    content: { label: string };
    updated: { label: string };
    id: { label: string };
  };
  const j = await getJson<{ feed?: { entry?: E[] | E } }>(
    `https://itunes.apple.com/us/rss/customerreviews/id=${app.trackId}/sortBy=mostRecent/json`,
  );
  const entries = Array.isArray(j.feed?.entry) ? (j.feed!.entry as E[]) : [];
  return entries
    .filter((e) => e.content)
    .map((e): RawReview => ({
      platform: "appstore",
      reviewer_name: e.author?.name?.label ?? null,
      reviewer_profile_url: null,
      source_url: `https://apps.apple.com/app/id${app.trackId}#review-${e.id?.label}`,
      text: `${e.title?.label ?? ""}. ${e.content?.label ?? ""}`,
      published_at: iso(e.updated?.label),
    }));
}

// ---------- Google Play (public web endpoint) ----------
async function googleplay(c: CompetitorCtx) {
  const page = await (
    await get(
      `https://play.google.com/store/search?q=${encodeURIComponent(c.name)}&c=apps&hl=en&gl=us`,
    )
  ).text();
  const ids = [
    ...new Set([...page.matchAll(/\/store\/apps\/details\?id=([\w.]+)/g)].map((m) => m[1]!)),
  ];
  const base = (c.domain?.split(".")[0] ?? c.name.split(/\s/)[0] ?? "").toLowerCase();
  const pkg = ids.find((id) => id.toLowerCase().includes(base));
  if (!pkg) throw new NoMatch("no matching app");
  const req = JSON.stringify([
    [
      [
        "oCPfdb",
        JSON.stringify([null, [2, 2, [40, null, null], null, []], [pkg, 7]]),
        null,
        "generic",
      ],
    ],
  ]);
  const r = await get("https://play.google.com/_/PlayStoreUi/data/batchexecute?hl=en&gl=us", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `f.req=${encodeURIComponent(req)}`,
  });
  const txt = await r.text();
  const line = txt.split("\n").find((l) => l.includes("oCPfdb"));
  if (!line) throw new Blocked("play no data");
  const inner = JSON.parse(JSON.parse(line)[0][2]);
  const list = (inner?.[0] ?? []) as unknown[][];
  return list.map((rv): RawReview => ({
    platform: "googleplay",
    reviewer_name: ((rv[1] as unknown[])?.[0] as string) ?? null,
    reviewer_profile_url: null,
    source_url: `https://play.google.com/store/apps/details?id=${pkg}&reviewId=${rv[0]}`,
    text: String(rv[4] ?? ""),
    published_at: new Date(Number((rv[5] as number[])?.[0] ?? 0) * 1000).toISOString(),
  }));
}

// ---------- Bluesky ----------
async function bluesky(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  type P = {
    uri: string;
    author: { handle: string; displayName?: string };
    record: { text: string; createdAt: string };
  };
  const q = encodeURIComponent(exactQuery(c.name));
  const limit = apply48HourFilter ? 50 : 100;
  let j: { posts: P[]; cursor?: string } | null = null;
  let activeHost = "https://api.bsky.app";
  for (const host of ["https://api.bsky.app", "https://public.api.bsky.app"]) {
    try {
      j = await getJson<{ posts: P[]; cursor?: string }>(
        `${host}/xrpc/app.bsky.feed.searchPosts?q=${q}&sort=latest&limit=${limit}`,
      );
      activeHost = host;
      break;
    } catch {
      /* try next */
    }
  }
  if (!j) throw new Blocked("bluesky");
  const allPosts = [...j.posts];
  if (!apply48HourFilter && j.cursor) {
    try {
      const page2 = await getJson<{ posts: P[] }>(
        `${activeHost}/xrpc/app.bsky.feed.searchPosts?q=${q}&sort=latest&limit=${limit}&cursor=${encodeURIComponent(j.cursor)}`,
      );
      allPosts.push(...(page2.posts ?? []));
    } catch {
      /* optional second historical page */
    }
  }
  return allPosts.map((p): RawReview => {
    const url = `https://bsky.app/profile/${p.author.handle}/post/${p.uri.split("/").pop()}`;
    return {
      platform: "bluesky",
      reviewer_name: p.author.displayName || p.author.handle,
      reviewer_profile_url: `https://bsky.app/profile/${p.author.handle}`,
      source_url: url,
      text: p.record.text,
      published_at: iso(p.record.createdAt),
    };
  });
}

// ---------- Mastodon (public hashtag timeline) ----------
async function mastodon(c: CompetitorCtx) {
  const tag = c.name.replace(/[^a-z0-9]/gi, "");
  type S = {
    url: string;
    content: string;
    created_at: string;
    account: { display_name: string; acct: string };
  };
  const list = await getJson<S[]>(
    `https://mastodon.social/api/v1/timelines/tag/${encodeURIComponent(tag)}?limit=40`,
  );
  return list.map((s): RawReview => ({
    platform: "mastodon",
    reviewer_name: s.account.display_name || s.account.acct,
    reviewer_profile_url: (s.account as { url?: string }).url ?? s.url,
    source_url: s.url,
    text: stripHtml(s.content),
    published_at: iso(s.created_at),
  }));
}

// ---------- Discourse community forums (competitor's own forum) ----------
async function forum(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  if (!c.domain) throw new NoMatch("no domain");
  const after = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const query = apply48HourFilter ? `after:${after} order:latest` : c.name;
  for (const host of [`community.${c.domain}`, `forum.${c.domain}`, `discuss.${c.domain}`]) {
    try {
      type DP = {
        username: string;
        name?: string;
        blurb: string;
        created_at: string;
        topic_id: number;
        post_number: number;
      };
      const j = await getJson<{ posts?: DP[]; topics?: { id: number; title: string }[] }>(
        `https://${host}/search.json?q=${encodeURIComponent(query)}`,
      );
      if (!j.posts) continue;
      const titles = new Map((j.topics ?? []).map((t) => [t.id, t.title]));
      return j.posts.map((p): RawReview => {
        const url = `https://${host}/t/${p.topic_id}/${p.post_number}`;
        return {
          platform: "forum",
          reviewer_name: p.name || p.username,
          reviewer_profile_url: url,
          source_url: url,
          text: `[${titles.get(p.topic_id) ?? ""}] ${p.blurb}`,
          published_at: iso(p.created_at),
        };
      });
    } catch {
      /* host doesn't exist */
    }
  }
  throw new NoMatch("no public forum");
}

// ---------- Stack Overflow ----------
async function stackexchange(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  type Q = {
    title: string;
    body?: string;
    link: string;
    creation_date: number;
    owner: { display_name: string; link?: string };
  };
  const dateFilter = apply48HourFilter ? `&fromdate=${since48()}` : "";
  const pageSize = apply48HourFilter ? 30 : 50;
  const j = await getJson<{ items: Q[] }>(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=creation&q=${encodeURIComponent(c.name)}&site=stackoverflow${dateFilter}&filter=withbody&pagesize=${pageSize}`,
  );
  return j.items.map((q): RawReview => ({
    platform: "stackexchange",
    reviewer_name: q.owner.display_name,
    reviewer_profile_url: (q.owner as { link?: string }).link ?? q.link,
    source_url: q.link,
    text: stripHtml(`${q.title}. ${q.body ?? ""}`).slice(0, 3000),
    published_at: new Date(q.creation_date * 1000).toISOString(),
  }));
}
// ---------- Dev.to ----------
async function devto(c: CompetitorCtx) {
  type A = {
    title: string;
    description?: string;
    url: string;
    published_at: string;
    user?: { name: string };
  };
  const tag = c.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const list = await getJson<A[]>(
    `https://dev.to/api/articles/latest?tag=${encodeURIComponent(tag)}&per_page=30`,
  );
  return list.map((a): RawReview => ({
    platform: "devto",
    reviewer_name: a.user?.name ?? null,
    reviewer_profile_url: (a.user as unknown as { username?: string } | undefined)?.username
      ? `https://dev.to/${(a.user as unknown as { username: string }).username}`
      : a.url,
    source_url: a.url,
    text: `${a.title}. ${a.description ?? ""}`,
    published_at: iso(a.published_at),
  }));
}

// ---------- Anonymous public-source adapters ----------

const SOCIALFETCH_SCRIPT =
  process.env["SOCIALFETCH_SCRIPT_PATH"]?.trim() || join(process.cwd(), "scripts", "socialfetch");
const SOCIALFETCH_TIMEOUT_MS = 25_000;

type JsonRecord = Record<string, unknown>;
function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}
function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Run the vendored SocialFetch CLI with a fixed argument array (never through a shell). */
async function runSocialFetch(args: string[]): Promise<unknown> {
  const python = process.env["SOCIALFETCH_PYTHON"]?.trim() || "python3";
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(
      python,
      [SOCIALFETCH_SCRIPT, ...args, "--json"],
      { timeout: SOCIALFETCH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, output, stderr) => {
        if (error) {
          const detail = asString(stderr).slice(0, 240);
          reject(new Blocked(detail
            ? `SocialFetch failed: ${detail}`
            : `SocialFetch could not run (${error.message.slice(0, 180)})`));
          return;
        }
        resolve(output);
      },
    );
  });
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout) as unknown;
  } catch {
    throw new Blocked("SocialFetch returned invalid JSON");
  }
  const result = asRecord(envelope);
  if (!result || result["ok"] !== true) {
    throw new Blocked(asString(result?.["error"]) || "SocialFetch returned an unsuccessful response");
  }
  return result["data"];
}

function redditPostUrl(post: JsonRecord): string {
  const permalink = asString(post["permalink"]);
  if (permalink.startsWith("https://")) return permalink;
  if (permalink.startsWith("/")) return `https://www.reddit.com${permalink}`;
  const id = asString(post["id"]);
  return id ? `https://www.reddit.com/comments/${encodeURIComponent(id)}/` : "";
}

export function mapSocialFetchRedditPosts(data: unknown): RawReview[] {
  const posts = asRecord(data)?.["posts"];
  if (!Array.isArray(posts)) return [];
  return posts.flatMap((item): RawReview[] => {
    const post = asRecord(item);
    if (!post) return [];
    const sourceUrl = redditPostUrl(post);
    const title = asString(post["title"]);
    const body = asString(post["selftext"]);
    const text = [title, body].filter(Boolean).join(". ").slice(0, 5000);
    if (!sourceUrl || !text) return [];
    const author = asString(post["author"]);
    return [{
      platform: "reddit",
      reviewer_name: author && author !== "[deleted]" ? author : null,
      reviewer_profile_url: author && author !== "[deleted]"
        ? `https://www.reddit.com/user/${encodeURIComponent(author)}/`
        : null,
      source_url: sourceUrl,
      text,
      published_at: normalizePublishedDate(post["created_utc"] ?? post["created_at"]),
    }];
  });
}

export function mapSocialFetchInstagramPosts(data: unknown, fallbackHandle: string): RawReview[] {
  const record = asRecord(data);
  const handle = asString(record?.["username"]) || fallbackHandle;
  const recent = record?.["recent"];
  if (!Array.isArray(recent)) return [];
  return recent.flatMap((item): RawReview[] => {
    const post = asRecord(item);
    if (!post) return [];
    const shortcode = asString(post["shortcode"]);
    const sourceUrl = asString(post["url"]) ||
      (shortcode ? `https://www.instagram.com/p/${shortcode}/` : "");
    const text = asString(post["caption"]);
    if (!sourceUrl || !text) return [];
    return [{
      platform: "instagram",
      reviewer_name: handle ? `@${handle}` : null,
      reviewer_profile_url: handle ? `https://www.instagram.com/${handle}/` : null,
      source_url: sourceUrl,
      text: text.slice(0, 5000),
      published_at: normalizePublishedDate(post["taken_at"] ?? post["published_at"]),
    }];
  });
}

export function mapSocialFetchFacebookPost(data: unknown): RawReview[] {
  const post = asRecord(data);
  if (!post) return [];
  const sourceUrl = asString(post["url"]);
  const text = asString(post["title"]);
  if (!sourceUrl || !text) return [];
  const author = asString(post["author"]);
  return [{
    platform: "facebook",
    reviewer_name: author || null,
    reviewer_profile_url: asString(post["author_url"]) || null,
    source_url: sourceUrl,
    text: text.slice(0, 5000),
    // Public oEmbed responses usually omit publication dates. Never invent one:
    // the existing metadata recovery + strict 48-hour gate remains authoritative.
    published_at: normalizePublishedDate(post["published_at"] ?? post["created_at"] ?? post["timestamp"]),
  }];
}

interface DiscoveredSocialLinks {
  instagramHandles: string[];
  facebookPostUrls: string[];
}

/** Inspect only social URLs explicitly linked from the competitor's own homepage. */
async function discoverCompetitorSocialLinks(c: CompetitorCtx): Promise<DiscoveredSocialLinks> {
  if (!c.domain?.trim()) return { instagramHandles: [], facebookPostUrls: [] };
  let homepage: URL;
  try {
    homepage = new URL(c.domain.includes("://") ? c.domain : `https://${c.domain}`);
    if (homepage.protocol !== "https:" && homepage.protocol !== "http:") {
      return { instagramHandles: [], facebookPostUrls: [] };
    }
  } catch {
    return { instagramHandles: [], facebookPostUrls: [] };
  }

  let html = "";
  try {
    const response = await fetch(homepage.toString(), {
      headers: { "User-Agent": BROWSER_UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { instagramHandles: [], facebookPostUrls: [] };
    html = (await response.text()).slice(0, 2_000_000);
  } catch {
    return { instagramHandles: [], facebookPostUrls: [] };
  }

  const instagramHandles = new Set<string>();
  const facebookPostUrls = new Set<string>();
  for (const match of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = match[1]!.replaceAll("&amp;", "&");
    let url: URL;
    try {
      url = new URL(href, homepage);
    } catch {
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (host === "instagram.com" || host.endsWith(".instagram.com")) {
      const handle = url.pathname.split("/").filter(Boolean)[0] ?? "";
      if (handle && !/^(p|reel|reels|tv|stories|explore|accounts|direct)$/i.test(handle) &&
          /^[a-z0-9._]{1,30}$/i.test(handle)) {
        instagramHandles.add(handle);
      }
    }
    if ((host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.watch") &&
        (/\/(posts|videos|watch|reel|reels|share\/p|share\/v)\//i.test(url.pathname) || host === "fb.watch")) {
      facebookPostUrls.add(url.toString());
    }
  }
  return {
    instagramHandles: [...instagramHandles].slice(0, 3),
    facebookPostUrls: [...facebookPostUrls].slice(0, 10),
  };
}

async function xLookup(c: CompetitorCtx, opts: ScrapePlatformOptions = {}): Promise<RawReview[]> {
  const base = (process.env["X_LOOKUP_BASE_URL"]?.trim() || "https://x-lookup.mynameistito.com")
    .replace(/\/+$/, "");
  const query = c.name.trim();
  if (!query) return [];
  const requestQuery = opts.apply48HourFilter === false
    ? query
    : `${query} since:${new Date(Date.now() - 48 * 3_600_000).toISOString().slice(0, 10)}`;
  const url = new URL(`${base}/search`);
  url.searchParams.set("q", requestQuery);
  url.searchParams.set("feed", "latest");
  url.searchParams.set("limit", "50");
  url.searchParams.set("format", "json");
  url.searchParams.set("full", "true");
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Blocked(`X Lookup returned HTTP ${response.status}`);
  const payload = asRecord(await response.json());
  const posts = payload?.["posts"];
  if (!Array.isArray(posts)) throw new Blocked("X Lookup returned an unexpected response");
  return posts.flatMap((item): RawReview[] => {
    const post = asRecord(item);
    if (!post) return [];
    const author = asRecord(post["author"]);
    const handle = asString(author?.["screen_name"]).replace(/^@/, "");
    const sourceUrl = asString(post["url"]) ||
      (handle && asString(post["id"]) ? `https://x.com/${handle}/status/${asString(post["id"])}` : "");
    const text = asString(post["text"]);
    if (!sourceUrl || !text) return [];
    return [{
      platform: "x",
      reviewer_name: handle ? `@${handle}` : asString(author?.["name"]) || null,
      reviewer_profile_url: asString(author?.["url"]) || (handle ? `https://x.com/${handle}` : null),
      source_url: sourceUrl,
      text: text.slice(0, 5000),
      published_at: normalizePublishedDate(post["created_at"] ?? post["created_timestamp"]),
    }];
  });
}

async function scrapeSocialFetchReddit(c: CompetitorCtx): Promise<RawReview[]> {
  if (!c.name.trim()) return [];
  const data = await runSocialFetch(["reddit", "search", c.name.trim(), "--limit", "50"]);
  return mapSocialFetchRedditPosts(data);
}

async function instagram(c: CompetitorCtx): Promise<RawReview[]> {
  const { instagramHandles } = await discoverCompetitorSocialLinks(c);
  if (!instagramHandles.length) throw new NoMatch("no public Instagram handle linked from competitor website");
  const results = await Promise.allSettled(instagramHandles.map(async (handle) => {
    const data = await runSocialFetch(["ig", "user", handle, "--limit", "40"]);
    return mapSocialFetchInstagramPosts(data, handle);
  }));
  const reviews = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!reviews.length) throw new NoMatch("no public Instagram posts available");
  return reviews;
}

async function facebook(c: CompetitorCtx): Promise<RawReview[]> {
  const { facebookPostUrls } = await discoverCompetitorSocialLinks(c);
  if (!facebookPostUrls.length) throw new NoMatch("no public Facebook post URLs linked from competitor website");
  const results = await Promise.allSettled(facebookPostUrls.map(async (url) => {
    const parsed = new URL(url);
    const action = /\/(videos|watch|reel|reels)\//i.test(parsed.pathname) || parsed.hostname === "fb.watch"
      ? "video"
      : "post";
    const data = await runSocialFetch(["fb", action, url]);
    return mapSocialFetchFacebookPost(data);
  }));
  const reviews = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!reviews.length) throw new NoMatch("no public Facebook post metadata available");
  return reviews;
}

// ---------- Reddit (SocialFetch public search) ----------
async function reddit(c: CompetitorCtx) {
  return scrapeSocialFetchReddit(c);
}

// ---------- ComplaintsBoard (server-rendered HTML; page found via free web search) ----------
async function complaintsboard(c: CompetitorCtx) {
  const { webSearch } = await import("./search.server");
  const res = await webSearch(`site:complaintsboard.com ${c.name}`);
  const url = res.map((r) => r.url).find((u) => /complaintsboard\.com\/[a-z0-9-]+-b\d+/i.test(u));
  if (!url) throw new NoMatch("no page");
  const html = await (await get(url)).text();
  const blocks = html.split('class="complaint__wrapper"').slice(1);
  if (!blocks.length) throw new NoMatch("no complaints");
  return blocks.map((b): RawReview => {
    const href = b.match(/href="(\/[a-z0-9-]+-c\d+)[^"]*"/i)?.[1] ?? "";
    const name =
      stripHtml(b.match(/class="author-header__name"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? "") || null;
    const date = stripHtml(b.match(/itemprop="datePublished">([^<]+)</)?.[1] ?? "");
    const time = stripHtml(b.match(/author-header__time">([^<]+)</)?.[1] ?? "").replace(
      /\s*UTC/,
      "",
    );
    const body = b
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/<div class="author-header[\s\S]*?author-header__row_flex[\s\S]*?<\/div>/, "");
    return {
      platform: "complaintsboard",
      reviewer_name: name,
      reviewer_profile_url: null,
      source_url: href ? `https://www.complaintsboard.com${href}` : "",
      text: stripHtml(body).slice(0, 3000),
      published_at: iso(`${date} ${time} UTC`),
    };
  });
}

// ---------- GitHub issues ----------
async function github(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  type I = {
    html_url: string;
    title: string;
    body: string | null;
    created_at: string;
    user: { login: string };
  };
  const day = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
  const q = apply48HourFilter ? `${exactQuery(c.name)} created:>=${day}` : exactQuery(c.name);
  const perPage = apply48HourFilter ? 30 : 50;
  const j = await getJson<{ items: I[] }>(
    `https://api.github.com/search/issues?q=${encodeURIComponent(q)}&sort=created&order=desc&per_page=${perPage}`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  return j.items.map((i): RawReview => ({
    platform: "github",
    reviewer_name: i.user.login,
    reviewer_profile_url: `https://github.com/${i.user.login}`,
    source_url: i.html_url,
    text: `${i.title}. ${i.body ?? ""}`.slice(0, 3000),
    published_at: iso(i.created_at),
  }));
}

// ---------- Lemmy ----------
async function lemmy(c: CompetitorCtx) {
  type L = {
    post: { name: string; body?: string; ap_id: string; published: string };
    creator: { name: string; display_name?: string };
  };
  const j = await getJson<{ posts: L[] }>(
    `https://lemmy.world/api/v3/search?q=${encodeURIComponent(c.name)}&type_=Posts&sort=New&limit=40`,
  );
  return j.posts.map((p): RawReview => ({
    platform: "lemmy",
    reviewer_name: p.creator.display_name || p.creator.name,
    reviewer_profile_url: p.post.ap_id,
    source_url: p.post.ap_id,
    text: `${p.post.name}. ${p.post.body ?? ""}`.slice(0, 3000),
    published_at: iso(p.post.published.endsWith("Z") ? p.post.published : `${p.post.published}Z`),
  }));
}

// ---------- Medium tag RSS ----------
async function medium(c: CompetitorCtx) {
  const { parseFeed } = await import("./pipeline");
  const tag = slugify(c.name);
  const xml = await (await get(`https://medium.com/feed/tag/${tag}`)).text();
  const creators = [
    ...xml.matchAll(/<dc:creator>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/dc:creator>/g),
  ].map((m) => m[1]!.trim());
  return parseFeed(xml).map((i, k): RawReview => ({
    platform: "medium",
    reviewer_name: creators[k] ?? null,
    reviewer_profile_url: i.link,
    source_url: i.link.split("?")[0]!,
    text: `${i.title}. ${i.summary}`,
    published_at: iso(i.date),
  }));
}

// ---------- Search-indexed posts (DuckDuckGo, Bing RSS fallback; no AI) ----------
const COMPLAINT_TERMS =
  '(frustrated OR switching OR alternative OR cancel OR disappointed OR worst OR problem OR "price increase")';
async function indexed(c: CompetitorCtx, site: string, opts: ScrapePlatformOptions = {}) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  const { webSearch } = await import("./search.server");
  const afterClause = apply48HourFilter
    ? " after:" + new Date(Date.now() - 48 * 3_600_000).toISOString().slice(0, 10)
    : "";
  const query = apply48HourFilter
    ? "site:" + site + ' "' + c.name + '"' + afterClause + " " + COMPLAINT_TERMS
    : "site:" + site + ' "' + c.name + '"';
  const res = await webSearch(query, { recent: apply48HourFilter });
  const host = site.split("/")[0]!;
  return res
    .filter((r) => r.url.includes(host) || (host === "x.com" && r.url.includes("twitter.com")))
    .map((r) => ({
      url: r.url,
      author: r.title.split(/ on (?:LinkedIn|X)| \| | - /)[0]!.trim(),
      text: r.title + ". " + r.snippet,
      date: parseSnippetDate(r.snippet) || (apply48HourFilter ? "" : new Date().toISOString()),
    }));
}

async function googlereviews(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const res = await indexed(c, "trustpilot.com/review", opts);
  return res
    .filter((r) => r.text.length > 40)
    .map((r): RawReview => ({
      platform: "googlereviews",
      reviewer_name: null,
      reviewer_profile_url: null,
      source_url: r.url,
      text: r.text,
      published_at: r.date,
    }));
}
const JIROSEARCH_PLATFORM_SET = new Set<Platform>([
  "linkedin",
  "youtube",
  "tiktok",
  "telegram",
  "pinterest",
  "threads",
]);

/** Translate app platform identifiers to the names accepted by Jirosearch. */
function toJirosearchApiPlatform(platform: Platform): string {
  return platform === "x" ? "twitter" : platform;
}

function inferPlatformFromUrl(sourceUrl: string): Platform | null {
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host.includes("linkedin.com")) return "linkedin";
    if (host === "x.com" || host.endsWith(".x.com") || host.includes("twitter.com")) return "x";
    if (host.includes("instagram.com")) return "instagram";
    if (host.includes("facebook.com") || host.includes("fb.watch")) return "facebook";
    if (host.includes("pinterest.") || host === "pin.it") return "pinterest";
    if (host.includes("tiktok.com")) return "tiktok";
    if (host.includes("youtube.com") || host === "youtu.be") return "youtube";
    if (host.includes("threads.net")) return "threads";
    if (host === "t.me" || host.includes("telegram.me")) return "telegram";
  } catch {
    /* ignore malformed URL */
  }
  return null;
}

function normalizeJirosearchPlatform(raw: unknown, fallback: Platform, sourceUrl = ""): Platform {
  if (typeof raw === "string") {
    const lower = raw.trim().toLowerCase();
    if (lower === "twitter" || lower === "x") return "x";
    if (lower === "youtube" || lower === "yt") return "youtube";
    if (lower === "linkedin" || lower === "li") return "linkedin";
    if (lower === "instagram" || lower === "ig") return "instagram";
    if (lower === "tiktok" || lower === "tt") return "tiktok";
    if (lower === "facebook" || lower === "fb") return "facebook";
    if (lower === "telegram" || lower === "tg") return "telegram";
    if (lower === "pinterest" || lower === "pin") return "pinterest";
    if (lower === "threads") return "threads";
  }
  return inferPlatformFromUrl(sourceUrl) ?? fallback;
}

function inferAuthorFromUrl(sourceUrl: string, platform: Platform): string | null {
  try {
    const u = new URL(sourceUrl);
    const parts = u.pathname.split("/").filter(Boolean);
    if (platform === "x" && parts[0] && !["i", "search", "explore", "hashtag"].includes(parts[0])) {
      return `@${parts[0].replace(/^@/, "")}`;
    }
    if (
      platform === "instagram" &&
      parts[0] &&
      !["p", "reel", "reels", "stories", "explore"].includes(parts[0])
    ) {
      return `@${parts[0].replace(/^@/, "")}`;
    }
    if (platform === "tiktok" && parts[0]?.startsWith("@")) {
      return parts[0];
    }
    if (platform === "threads" && parts[0]?.startsWith("@")) {
      return parts[0];
    }
    if (platform === "telegram" && parts[0] && parts[0] !== "s") {
      return `@${parts[0].replace(/^@/, "")}`;
    }
    if (platform === "telegram" && parts[0] === "s" && parts[1]) {
      return `@${parts[1].replace(/^@/, "")}`;
    }
    if (platform === "pinterest" && parts[0] && !["pin", "search", "ideas"].includes(parts[0])) {
      return parts[0];
    }
    if (
      platform === "facebook" &&
      parts[0] &&
      !["watch", "reel", "share", "groups"].includes(parts[0])
    ) {
      return parts[0];
    }
    if (platform === "linkedin" && parts[0] === "in" && parts[1]) {
      return parts[1].replace(/-/g, " ");
    }
  } catch {
    /* ignore malformed URL */
  }
  return null;
}

const JIROSEARCH_TIMEOUT_MS = 60_000;

export function resolveJirosearchEndpoint(): string | null {
  const raw =
    process.env["JIRO_SEARCH_URL"]?.trim() || process.env["JIROSEARCH_API_URL"]?.trim() || "";
  if (raw) {
    const trimmed = raw.replace(/\/+$/, "");
    if (/\/(?:api\/)?(?:v1\/)?social\/search$/i.test(trimmed)) {
      return trimmed;
    }
    if (/\/(?:api\/search|v1\/search|search)$/i.test(trimmed)) {
      return trimmed.replace(/\/search$/i, "/social/search");
    }
    return `${trimmed}/social/search`;
  }
  if (process.env["JIROSEARCH_API_KEY"]?.trim()) {
    return "https://api.jirosearch.com/v1/social/search";
  }
  return null;
}

export function hasJirosearchConfig(): boolean {
  return resolveJirosearchEndpoint() !== null;
}

function extractJirosearchRawList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const obj = payload as Record<string, unknown>;
  for (const key of [
    "results",
    "data",
    "items",
    "posts",
    "social_results",
    "organic_results",
    "reviews",
    "hits",
    "news_results",
  ]) {
    const val = obj[key];
    if (Array.isArray(val)) return val as unknown[];
    if (val && typeof val === "object") {
      const flattened: unknown[] = [];
      for (const [platformKey, bucket] of Object.entries(val as Record<string, unknown>)) {
        if (!Array.isArray(bucket)) continue;
        for (const entry of bucket) {
          if (entry && typeof entry === "object") {
            flattened.push({
              ...(entry as Record<string, unknown>),
              ...("source" in (entry as Record<string, unknown>) ||
              "platform" in (entry as Record<string, unknown>)
                ? {}
                : { source: platformKey }),
            });
          }
        }
      }
      if (flattened.length > 0) return flattened;
    }
  }

  // Handle direct platform-keyed response objects like { linkedin: [...], x: [...] }
  const directFlattened: unknown[] = [];
  for (const [key, val] of Object.entries(obj)) {
    if (!Array.isArray(val)) continue;
    for (const entry of val) {
      if (entry && typeof entry === "object") {
        directFlattened.push({
          ...(entry as Record<string, unknown>),
          ...("source" in (entry as Record<string, unknown>) ||
          "platform" in (entry as Record<string, unknown>)
            ? {}
            : { source: key }),
        });
      }
    }
  }
  return directFlattened;
}

function mapJirosearchItems(
  rawList: unknown[],
  fallbackPlatform: Platform,
  apply48HourFilter: boolean | undefined,
): RawReview[] {
  const out: RawReview[] = [];

  for (const entry of rawList) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const userObj =
      item["user"] && typeof item["user"] === "object"
        ? (item["user"] as Record<string, unknown>)
        : item["author"] && typeof item["author"] === "object"
          ? (item["author"] as Record<string, unknown>)
          : null;

    const rawReviewId = typeof item["reviewId"] === "string" ? item["reviewId"].trim() : "";
    const rawSourceUrl =
      item["sourceUrl"] ??
      item["source_url"] ??
      item["postUrl"] ??
      item["post_url"] ??
      item["url"] ??
      item["link"] ??
      item["permalink"] ??
      item["web_url"] ??
      item["href"] ??
      (/^https?:\/\//i.test(rawReviewId) ? rawReviewId : null);
    const sourceUrl = typeof rawSourceUrl === "string" ? rawSourceUrl.trim() : "";
    if (!/^https?:\/\//i.test(sourceUrl)) continue;

    const platform = normalizeJirosearchPlatform(
      item["source"] ?? item["platform"],
      fallbackPlatform,
      sourceUrl,
    );

    const rawTitle = typeof item["title"] === "string" ? stripHtml(item["title"]) : "";
    const rawBodyVal =
      item["body"] ??
      item["text"] ??
      item["post_text"] ??
      item["postText"] ??
      item["content"] ??
      item["snippet"] ??
      item["caption"] ??
      item["description"] ??
      item["message"] ??
      item["summary"];
    const rawBody = typeof rawBodyVal === "string" ? stripHtml(rawBodyVal) : "";
    const text = (
      rawTitle && rawBody && !rawBody.toLowerCase().startsWith(rawTitle.toLowerCase())
        ? `${rawTitle}. ${rawBody}`
        : rawBody || rawTitle
    )
      .trim()
      .slice(0, 3000);
    if (!text) continue;

    const rawReviewer =
      item["reviewerName"] ??
      item["reviewer_name"] ??
      item["authorName"] ??
      item["author_name"] ??
      item["author_handle"] ??
      item["authorHandle"] ??
      (typeof item["author"] === "string" ? item["author"] : null) ??
      item["username"] ??
      item["user_name"] ??
      item["handle"] ??
      item["creator"] ??
      item["channelTitle"] ??
      userObj?.["name"] ??
      userObj?.["display_name"] ??
      userObj?.["full_name"] ??
      userObj?.["username"] ??
      userObj?.["handle"];
    const reviewerName =
      (typeof rawReviewer === "string" && rawReviewer.trim() ? rawReviewer.trim() : null) ??
      inferAuthorFromUrl(sourceUrl, platform);

    const rawProfileUrl =
      item["reviewerProfileUrl"] ??
      item["reviewer_profile_url"] ??
      item["authorUrl"] ??
      item["author_url"] ??
      item["profileUrl"] ??
      item["profile_url"] ??
      userObj?.["url"] ??
      userObj?.["profileUrl"] ??
      userObj?.["profile_url"];
    const profileUrl =
      typeof rawProfileUrl === "string" && /^https?:\/\//i.test(rawProfileUrl.trim())
        ? rawProfileUrl.trim()
        : null;

    const rawDates = [
      item["reviewedAt"],
      item["reviewed_at"],
      item["publishedAt"],
      item["published_at"],
      item["createdAt"],
      item["created_at"],
      item["created_utc"],
      item["datePublished"],
      item["date_published"],
      item["postedAt"],
      item["posted_at"],
      item["postDate"],
      item["post_date"],
      item["date"],
      item["timestamp"],
      item["time"],
      item["created"],
    ];
    const parsedDate =
      rawDates.map(normalizePublishedDate).find(Boolean) || parseSnippetDate(rawBody);

    out.push({
      platform,
      reviewer_name: reviewerName,
      reviewer_profile_url: profileUrl,
      source_url: sourceUrl,
      text,
      published_at: parsedDate || (apply48HourFilter === false ? new Date().toISOString() : ""),
    });
  }

  return out;
}

export async function scrapeJirosearch(
  query: string,
  platforms: string[],
  options: {
    domain?: string | null | undefined;
    intent?: "complaints" | "mentions" | undefined;
    apply48HourFilter?: boolean | undefined;
  } = {},
): Promise<RawReview[]> {
  const endpoint = resolveJirosearchEndpoint();
  const apiKey = process.env["JIROSEARCH_API_KEY"]?.trim();

  const normalizedPlatforms = Array.from(
    new Set(
      platforms
        .map((p) => p.trim().toLowerCase())
        .map((p) => (p === "twitter" ? "x" : p))
        .filter((p): p is Platform => JIROSEARCH_PLATFORM_SET.has(p as Platform)),
    ),
  );

  if (!query.trim() || normalizedPlatforms.length === 0) return [];
  if (!endpoint) {
    console.warn("[Jirosearch] JIRO_SEARCH_URL is not set; returning empty results.");
    return [];
  }

  const queryText = options.apply48HourFilter
    ? query.trim() + " after:" + new Date(Date.now() - 48 * 3_600_000).toISOString().slice(0, 10)
    : query.trim();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  const perPlatformResults = await Promise.all(
    normalizedPlatforms.map(async (targetPlatform): Promise<RawReview[]> => {
      const requestPayload = {
        query: queryText,
        // The app uses "x" internally, but Jirosearch's API expects "twitter".
        platform: toJirosearchApiPlatform(targetPlatform),
        limit: 10,
      };

      try {
        console.log("[Jirosearch] Sending POST request:", {
          url: endpoint,
          payload: requestPayload,
        });

        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(requestPayload),
          signal: AbortSignal.timeout(JIROSEARCH_TIMEOUT_MS),
        });

        const rawText = await res.text();
        console.log("[Jirosearch] Response received:", {
          url: endpoint,
          platform: targetPlatform,
          status: res.status,
          ok: res.ok,
          body: rawText.slice(0, 4000),
        });

        if (!res.ok) {
          console.warn(
            `[Jirosearch] HTTP ${res.status} for platform '${targetPlatform}' from ${endpoint}; skipping.`,
          );
          return [];
        }

        let payload: unknown = null;
        try {
          payload = rawText ? (JSON.parse(rawText) as unknown) : null;
        } catch (parseErr) {
          console.warn(
            `[Jirosearch] Invalid JSON returned for platform '${targetPlatform}' by ${endpoint}:`,
            parseErr instanceof Error ? parseErr.message : parseErr,
          );
          return [];
        }

        const rawList = extractJirosearchRawList(payload);
        const mapped = mapJirosearchItems(rawList, targetPlatform, options.apply48HourFilter);

        if (rawList.length > 0 && mapped.length === 0) {
          const sample = rawList[0];
          console.warn("[Jirosearch] Raw items were returned but 0 mapped to RawReview:", {
            platform: targetPlatform,
            rawCount: rawList.length,
            sampleKeys: sample && typeof sample === "object" ? Object.keys(sample) : typeof sample,
          });
        } else {
          console.log("[Jirosearch] Mapped reviews:", {
            platform: targetPlatform,
            rawCount: rawList.length,
            mappedCount: mapped.length,
          });
        }

        return mapped;
      } catch (err) {
        console.warn(
          `[Jirosearch] Request for platform '${targetPlatform}' to ${endpoint} failed:`,
          err instanceof Error ? `${err.name}: ${err.message}` : err,
        );
        return [];
      }
    }),
  );

  return perPlatformResults.flat();
}

export async function filterAndRecoverJirosearchReviews(
  all: RawReview[],
  apply48HourFilter = true,
): Promise<RawReview[]> {
  const prepared = apply48HourFilter ? await recoverMissingPublishedDates(all) : all;
  return prepared.filter((r) => {
    if (!r.text || !r.source_url) return false;
    if (apply48HourFilter && !isRecent(r.published_at)) return false;
    return r.reviewer_name !== "[deleted]";
  });
}

async function linkedin(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  return scrapeJirosearch(c.name, ["linkedin"], {
    domain: c.domain,
    intent: opts.intent,
    apply48HourFilter: opts.apply48HourFilter ?? true,
  });
}
async function x(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  return xLookup(c, opts);
}
async function youtube(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  return scrapeJirosearch(c.name, ["youtube"], {
    domain: c.domain,
    intent: opts.intent,
    apply48HourFilter: opts.apply48HourFilter ?? true,
  });
}
// Instagram is handled by the anonymous SocialFetch adapter above.
async function tiktok(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  return scrapeJirosearch(c.name, ["tiktok"], {
    domain: c.domain,
    intent: opts.intent,
    apply48HourFilter: opts.apply48HourFilter ?? true,
  });
}
// Facebook is handled by the anonymous SocialFetch adapter above.
async function telegram(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  return scrapeJirosearch(c.name, ["telegram"], {
    domain: c.domain,
    intent: opts.intent,
    apply48HourFilter: opts.apply48HourFilter ?? true,
  });
}
async function pinterest(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  return scrapeJirosearch(c.name, ["pinterest"], {
    domain: c.domain,
    intent: opts.intent,
    apply48HourFilter: opts.apply48HourFilter ?? true,
  });
}

// ---------- Newer free sources ----------
/** Search-index posts for a site set; publication dates are parsed or recovered before 48-hour filtering. */
async function searchSites(
  c: CompetitorCtx,
  sites: string[],
  urlRe: RegExp,
  extra = COMPLAINT_TERMS,
  opts: ScrapePlatformOptions = {},
) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  const { webSearch } = await import("./search.server");
  const effectiveExtra = apply48HourFilter ? extra : "";
  const afterClause = apply48HourFilter
    ? " after:" + new Date(Date.now() - 48 * 3_600_000).toISOString().slice(0, 10)
    : "";
  const q =
    "(" +
    sites.map((s) => "site:" + s).join(" OR ") +
    ') "' +
    c.name +
    '"' +
    afterClause +
    " " +
    effectiveExtra;
  const res = (await webSearch(q.trim(), { recent: apply48HourFilter })).filter((r) =>
    urlRe.test(r.url),
  );
  return res.map((r) => ({
    url: r.url.split("#")[0]!,
    title: r.title,
    text: r.title + ". " + r.snippet,
    date: parseSnippetDate(r.snippet) || (apply48HourFilter ? "" : new Date().toISOString()),
  }));
}

async function alternativeto(c: CompetitorCtx) {
  const r = await get(`https://alternativeto.net/software/${slugify(c.name)}/about/`);
  if (r.status === 404) throw new NoMatch("not on alternativeto");
  if (!r.ok) throw new Blocked(`alternativeto ${r.status}`);
  const html = await r.text();
  const out = jsonLdReviews(html, "alternativeto", r.url);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) {
        n.forEach(walk);
        return;
      }
      if (!n || typeof n !== "object") return;
      const o = n as Record<string, unknown>;
      const text = o["text"] ?? o["body"] ?? o["comment"];
      const date = o["createdAt"] ?? o["created"] ?? o["date"];
      const user = o["user"] as { userName?: string; name?: string; urlName?: string } | undefined;
      if (typeof text === "string" && text.length > 40 && date) {
        out.push({
          platform: "alternativeto",
          reviewer_name: user?.name ?? user?.userName ?? null,
          reviewer_profile_url: user?.urlName
            ? `https://alternativeto.net/user/${user.urlName}/`
            : null,
          source_url: `${r.url}#${slugify(String(o["id"] ?? text.slice(0, 30)))}`,
          text: stripHtml(text),
          published_at: iso(date),
        });
      }
      Object.values(o).forEach(walk);
    };
    try {
      walk(JSON.parse(m[1]!));
    } catch {
      /* ignore */
    }
  }
  return out;
}
async function discourse(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const hits = await searchSites(
    c,
    ["discourse.org", "community.*", "forum.*", "discuss.*"],
    /\/t\/[^/]+\/\d+/,
    COMPLAINT_TERMS,
    opts,
  );
  if (!hits.length) throw new NoMatch("no threads");
  const out: RawReview[] = [];
  for (const h of hits.slice(0, 6)) {
    try {
      const base = h.url.match(/^(https?:\/\/[^/]+\/t\/[^/]+\/\d+)/)![1]!;
      type P = {
        username: string;
        name?: string;
        cooked: string;
        created_at: string;
        post_number: number;
      };
      const j = await getJson<{ title: string; post_stream: { posts: P[] } }>(`${base}.json`);
      const host = new URL(base).origin;
      for (const p of j.post_stream.posts)
        out.push({
          platform: "discourse",
          reviewer_name: p.name || p.username,
          reviewer_profile_url: `${host}/u/${p.username}`,
          source_url: `${base}/${p.post_number}`,
          text: `[${j.title}] ${stripHtml(p.cooked)}`.slice(0, 2000),
          published_at: iso(p.created_at),
        });
    } catch {
      /* not a discourse site */
    }
  }
  return out;
}
async function quora(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const hits = await searchSites(c, ["quora.com"], /quora\.com\//, COMPLAINT_TERMS, opts);
  if (!hits.length) throw new NoMatch("no quora threads");
  return hits.map((h): RawReview => ({
    platform: "quora",
    reviewer_name:
      h.url
        .match(/quora\.com\/profile\/([^/?]+)/)?.[1]
        ?.replace(/-\d*$/, "")
        .replace(/-/g, " ") ?? null,
    reviewer_profile_url: null,
    source_url: h.url,
    text: h.text,
    published_at: h.date,
  }));
}

async function sitejabber(c: CompetitorCtx) {
  if (!c.domain) throw new NoMatch("no domain");
  const r = await get(`https://www.sitejabber.com/reviews/${c.domain.replace(/^www\./, "")}`);
  if (r.status === 404) throw new NoMatch("not on sitejabber");
  if (!r.ok) throw new Blocked(`sitejabber ${r.status}`);
  const out = jsonLdReviews(await r.text(), "sitejabber", r.url);
  if (!out.length) throw new NoMatch("no reviews");
  return out;
}
async function trustradius(c: CompetitorCtx) {
  const r = await get(`https://www.trustradius.com/products/${slugify(c.name)}/reviews`);
  if (r.status === 404) throw new NoMatch("not on trustradius");
  if (!r.ok) throw new Blocked(`trustradius ${r.status}`);
  const html = await r.text();
  if (/cf-chl|captcha/i.test(html)) throw new Blocked("trustradius captcha");
  return jsonLdReviews(html, "trustradius", r.url);
}
async function feedback(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const hits = await searchSites(
    c,
    ["canny.io", "featurebase.app", "upvoty.com"],
    /(canny\.io|featurebase\.app|upvoty\.com)\//,
    "",
    opts,
  );
  if (!hits.length) throw new NoMatch("no feedback board");
  return hits.map((h): RawReview => ({
    platform: "feedback",
    reviewer_name: null,
    reviewer_profile_url: null,
    source_url: h.url,
    text: h.text,
    published_at: h.date,
  }));
}
async function bbb(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const hits = await searchSites(
    c,
    ["bbb.org"],
    /bbb\.org\/.*(complaints|customer-reviews)/,
    "",
    opts,
  );
  if (!hits.length) throw new NoMatch("not on bbb");
  const out: RawReview[] = [];
  for (const h of hits.slice(0, 2)) {
    try {
      const r = await get(h.url);
      if (!r.ok) continue;
      out.push(...jsonLdReviews(await r.text(), "bbb", r.url));
    } catch {
      /* skip */
    }
  }
  return out.length
    ? out
    : hits.map((h): RawReview => ({
        platform: "bbb",
        reviewer_name: null,
        reviewer_profile_url: null,
        source_url: h.url,
        text: h.text,
        published_at: h.date,
      }));
}

export async function scrapeThreadsReviews(
  keyword: string,
  opts: { limit?: number } = {},
): Promise<RawReview[]> {
  const { testThreadsScraper } = await import("@/server/socialTest");
  const res = await testThreadsScraper(keyword, opts);
  if (!res.ok && res.error && /blocked or gated|403|captcha|login/i.test(res.error)) {
    throw new Blocked(res.error);
  }

  const out: RawReview[] = [];
  for (const row of res.results) {
    const body = (row["comment_text"] ?? "").trim();
    if (!body || body.length < 10) continue;

    const postCode = (row["post_code"] ?? "").trim();
    if (!postCode) continue;

    const ts = Number.parseInt(row["timestamp"] ?? "", 10);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    const reviewedAt = new Date(ts * 1000).toISOString();

    const username = (row["username"] ?? "").trim().replace(/^@/, "");
    const sourceUrl = username
      ? `https://www.threads.net/@${username}/post/${postCode}`
      : `https://www.threads.net/post/${postCode}`;

    out.push({
      platform: "threads",
      reviewer_name: username || null,
      reviewer_profile_url: username ? `https://www.threads.net/@${username}` : null,
      source_url: sourceUrl,
      text: body.slice(0, 3000),
      published_at: reviewedAt,
    });
  }
  return out;
}

async function threads(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  try {
    const cliReviews = await scrapeThreadsReviews(c.name, { limit: apply48HourFilter ? 15 : 50 });
    if (cliReviews.length > 0) return cliReviews;
  } catch {
    /* threads-scraper unavailable or blocked; fall back to Jirosearch */
  }
  return scrapeJirosearch(c.name, ["threads"], {
    domain: c.domain,
    intent: opts.intent,
    apply48HourFilter: opts.apply48HourFilter ?? true,
  });
}

const SOURCES: Record<
  Platform,
  (c: CompetitorCtx, opts?: ScrapePlatformOptions) => Promise<RawReview[]>
> = {
  hackernews,
  producthunt,
  trustpilot,
  capterra,
  g2,
  appstore,
  googleplay,
  bluesky,
  mastodon,
  forum,
  stackexchange,
  devto,
  reddit,
  complaintsboard,
  github,
  lemmy,
  medium,
  googlereviews,
  linkedin,
  x,
  alternativeto,
  discourse,
  quora,
  youtube,
  sitejabber,
  trustradius,
  feedback,
  bbb,
  threads,
  instagram,
  tiktok,
  facebook,
  telegram,
  pinterest,
};

export async function scrapePlatform(
  c: CompetitorCtx,
  platform: Platform,
  opts: ScrapePlatformOptions = {},
): Promise<SourceResult> {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  try {
    if (JIROSEARCH_PLATFORM_SET.has(platform) && platform !== "threads" && !hasJirosearchConfig()) {
      return { status: "no_key", reviews: [] };
    }
    const all = await SOURCES[platform](c, opts);
    // Recover missing timestamps from URL IDs or the post page before applying the strict age gate.
    const prepared = apply48HourFilter ? await recoverMissingPublishedDates(all) : all;
    const reviews = prepared.filter((r) => {
      if (!r.text || !r.source_url) return false;
      if (apply48HourFilter && !isRecent(r.published_at)) return false;

      // Keep Jirosearch's existing author-name tolerance; only change its date filtering.
      if (JIROSEARCH_PLATFORM_SET.has(platform)) return r.reviewer_name !== "[deleted]";
      return keepReview(r, undefined, { skipRecencyCheck: true });
    });
    return { status: "ok", reviews };
  } catch (e) {
    console.warn("source", platform, e instanceof Error ? e.message : e);
    if (e instanceof NoMatch) return { status: "no_match", reviews: [] };
    if (e instanceof Error && e.message === "no_key") return { status: "no_key", reviews: [] };
    return { status: "blocked", reviews: [] };
  }
}

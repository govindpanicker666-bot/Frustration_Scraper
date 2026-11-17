import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { linkedinAuthorFromPost, parseBingRss, parseDdgHtml, type SearchResult } from "./pipeline";

const execFileAsync = promisify(execFile);
const SCRAPER_DIR = join(process.cwd(), "scripts", "toolzerhub");
const PYTHON = process.env["PYTHON_BIN"]?.trim() || (process.platform === "win32" ? "python" : "python3");

export interface LinkedInPublicPost {
  url: string; text: string; publishedAt: string; authorName: string | null; authorUrl: string | null;
}
export interface ThreadsPublicPost {
  url: string; code: string; text: string; createdAt: string; username: string | null; fullName: string | null;
}
interface LinkedInSearchHit extends SearchResult { publishedAt?: string }
type LinkedInSearchProvider = "Google" | "DuckDuckGo" | "Bing";
type LinkedInProviderResultCounts = Record<LinkedInSearchProvider, number>;

async function runPython(script: string, args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(PYTHON, [join(SCRAPER_DIR, script), ...args], {
      cwd: SCRAPER_DIR, env: process.env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    });
    return stdout.trim();
  } catch (error) {
    throw new Error(`Public scraper failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 500)}`);
  }
}
function parseJson(stdout: string): unknown {
  try { return JSON.parse(stdout) as unknown; }
  catch { throw new Error("Public scraper returned invalid JSON."); }
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function textValue(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function dateIso(value: unknown): string {
  const raw = textValue(value); const date = new Date(raw);
  return raw && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
}

function decodeSearchHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function unwrapSearchResultUrl(value: unknown): string {
  let candidate = decodeSearchHtml(textValue(value));
  if (candidate.startsWith("//")) candidate = "https:" + candidate;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase();
      if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return parsed.toString();

      // Bing RSS commonly wraps destination URLs in /ck/a?u=a1<base64url>.
      if (host === "bing.com" || host.endsWith(".bing.com")) {
        const encoded = parsed.searchParams.get("u") ?? "";
        if (encoded.startsWith("a1") && encoded.length > 2) {
          const decoded = Buffer.from(encoded.slice(2), "base64url").toString("utf8");
          if (/^https?:\/\//i.test(decoded)) {
            candidate = decoded;
            continue;
          }
        }
      }

      const wrapped = ["uddg", "url", "q", "u", "target", "dest"]
        .map((key) => parsed.searchParams.get(key))
        .find((entry) => entry && /^https?:\/\//i.test(entry));
      if (!wrapped || wrapped === candidate) return candidate;
      candidate = wrapped;
    } catch {
      return candidate;
    }
  }
  return candidate;
}

export function normalizeLinkedInPostUrl(value: unknown): string | null {
  try {
    const url = new URL(unwrapSearchResultUrl(value));
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || !(host === "linkedin.com" || host.endsWith(".linkedin.com"))) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (!(/^\/posts\//i.test(pathname) || /^\/feed\/update\//i.test(pathname))) return null;
    return "https://www.linkedin.com" + pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
function activityDate(url: string): string {
  const id = url.match(/activity[-:](\d{15,20})(?:[-/:?#]|$)/i)?.[1];
  if (!id) return "";
  try {
    const milliseconds = Number(BigInt(id) >> 22n);
    const date = new Date(milliseconds);
    return Number.isFinite(milliseconds) && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
  } catch { return ""; }
}
const LINKEDIN_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const LINKEDIN_SEARCH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function parseLinkedInSearchDate(value: string, now = Date.now()): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const relative = text.match(
    /(?:^|[|·•–—]\s*|\b(?:posted|published|created|updated)\s*(?:on|at|:)?\s*)(just now|moments ago|today|yesterday|\d{1,4}\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mo|years?|y)(?:\s*ago)?)(?=$|[\s|·•–—])/i,
  );
  if (relative && relative[1]) {
    const label = relative[1].toLowerCase();
    if (label === "just now" || label === "moments ago" || label === "today") return new Date(now).toISOString();
    if (label === "yesterday") return new Date(now - 36 * 60 * 60 * 1000).toISOString();
    const amountMatch = label.match(/(\d{1,4})\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mo|years?|y)/i);
    if (amountMatch) {
      const amount = Number(amountMatch[1]);
      const unit = amountMatch[2].toLowerCase();
      const unitMs = /^(s|sec|secs|second|seconds)$/.test(unit) ? 1000
        : /^(m|min|mins|minute|minutes)$/.test(unit) ? 60 * 1000
        : /^(h|hr|hrs|hour|hours)$/.test(unit) ? 60 * 60 * 1000
        : /^(d|day|days)$/.test(unit) ? 24 * 60 * 60 * 1000
        : /^(w|week|weeks)$/.test(unit) ? 7 * 24 * 60 * 60 * 1000
        : /^(mo|month|months)$/.test(unit) ? 30 * 24 * 60 * 60 * 1000
        : 365 * 24 * 60 * 60 * 1000;
      const conservativeOffset = /^(d|day|days)$/.test(unit) ? 12 * 60 * 60 * 1000 : 0;
      return new Date(now - amount * unitMs - conservativeOffset).toISOString();
    }
  }
  const absolute = text.match(
    /(?:^|[|·•–—]\s*|\b(?:posted|published|created|updated)\s*(?:on|at|:)?\s*)(20\d{2}-\d{1,2}-\d{1,2}(?:[T ][0-9:.Z+-]+)?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+20\d{2})?|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+20\d{2})?)(?=$|[\s|·•–—])/i,
  );
  if (!absolute || !absolute[1]) return "";
  const dateText = absolute[1];
  const normalizedDate = /\b20\d{2}\b/.test(dateText) ? dateText : dateText + ", " + new Date(now).getUTCFullYear();
  const parsed = new Date(normalizedDate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function isLinkedInPostWithin48Hours(publishedAt: string, now: number): boolean {
  const timestamp = Date.parse(publishedAt);
  const age = now - timestamp;
  return Number.isFinite(timestamp) && age >= -5 * 60 * 1000 && age <= 48 * 60 * 60 * 1000;
}

function stripSearchMarkup(value: string): string {
  return decodeSearchHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function parseGoogleLinkedInResults(html: string): LinkedInSearchHit[] {
  const results: LinkedInSearchHit[] = [];
  const blocks = html.split(/<div\b[^>]*class=["'][^"']*\bMjjYud\b[^"']*["'][^>]*>/i).slice(1);
  const candidates = blocks.length ? blocks : [html];

  for (const block of candidates) {
    const anchor = block.match(
      /<a\b[^>]*href=(["'])(.*?)\1[^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/i,
    );
    if (!anchor?.[2] || !anchor[3]) continue;

    const snippetMatch = block.match(
      /<(?:div|span)\b[^>]*class=(["'])[^"']*(?:VwiC3b|IsZvec|aCOpRe|s3v9rd|yXK7lf)[^"']*\1[^>]*>([\s\S]*?)<\/(?:div|span)>/i,
    );
    const title = stripSearchMarkup(anchor[3]);
    const snippet = snippetMatch?.[2] ? stripSearchMarkup(snippetMatch[2]) : "";
    const cardText = stripSearchMarkup(block);
    const publishedAt = parseLinkedInSearchDate(cardText);

    results.push({
      url: decodeSearchHtml(anchor[2]),
      title,
      snippet,
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  return results;
}

function dateForGoogleSearch(value: string): string {
  const [year, month, day] = value.split("-");
  return month + "/" + day + "/" + year;
}

async function searchLinkedInIndex(
  query: string,
  recent: boolean,
  startDate: string,
  endDate: string,
): Promise<{
  results: LinkedInSearchHit[];
  errors: string[];
  successfulProviders: LinkedInSearchProvider[];
  providerResultCounts: LinkedInProviderResultCounts;
}> {
  const headers = {
    "User-Agent": LINKEDIN_SEARCH_UA,
    "Accept-Language": "en-US,en;q=0.9",
  };

  const googleUrl = new URL("https://www.google.com/search");
  googleUrl.searchParams.set("q", query);
  googleUrl.searchParams.set("num", "20");
  if (recent) {
    googleUrl.searchParams.set(
      "tbs",
      "cdr:1,cd_min:" + dateForGoogleSearch(startDate) + ",cd_max:" + dateForGoogleSearch(endDate),
    );
  }

  const ddgUrl = new URL("https://html.duckduckgo.com/html/");
  ddgUrl.searchParams.set("q", query);
  if (recent) ddgUrl.searchParams.set("df", "w");

  const bingUrl = new URL("https://www.bing.com/search");
  bingUrl.searchParams.set("format", "rss");
  bingUrl.searchParams.set("q", query);
  if (recent) bingUrl.searchParams.set("filters", 'ex1:"ez2"');

  const attempts = await Promise.allSettled([
    fetch(googleUrl, {headers, signal:AbortSignal.timeout(12_000)}).then(async response => {
      if (!response.ok) throw new Error("Google HTTP " + response.status);
      const html = await response.text();
      if (/unusual traffic|sorry\/index|our systems have detected/i.test(html)) {
        throw new Error("Google returned an automated-traffic challenge");
      }
      return parseGoogleLinkedInResults(html);
    }),
    fetch(ddgUrl, {headers, signal:AbortSignal.timeout(9_000)}).then(async response => {
      if (!response.ok) throw new Error("DuckDuckGo HTTP " + response.status);
      return parseDdgHtml(await response.text());
    }),
    fetch(bingUrl, {headers, signal:AbortSignal.timeout(9_000)}).then(async response => {
      if (!response.ok) throw new Error("Bing HTTP " + response.status);
      return parseBingRss(await response.text());
    }),
  ]);

  const results: LinkedInSearchHit[] = [];
  const errors: string[] = [];
  const successfulProviders: LinkedInSearchProvider[] = [];
  const providerResultCounts: LinkedInProviderResultCounts = {
    Google: 0,
    "DuckDuckGo": 0,
    Bing: 0,
  };
  const providerNames: LinkedInSearchProvider[] = ["Google", "DuckDuckGo", "Bing"];
  attempts.forEach((attempt, index) => {
    const providerName = providerNames[index]!;
    if (attempt.status === "fulfilled") {
      successfulProviders.push(providerName);
      providerResultCounts[providerName] = attempt.value.length;
      results.push(...attempt.value);
    } else {
      const reason = attempt.reason instanceof Error ? attempt.reason.message : String(attempt.reason);
      errors.push(providerName + ": " + reason);
    }
  });

  return {results, errors, successfulProviders, providerResultCounts};
}

export function normalizeLinkedInScrapedPosts(payload: unknown): LinkedInPublicPost[] {
  const rows = record(payload)?.["posts"];
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>(); const posts: LinkedInPublicPost[] = [];
  for (const value of rows) {
    const row = record(value); if (!row) continue;
    const url = normalizeLinkedInPostUrl(row["url"]); const body = textValue(row["text"]);
    if (!url || !body || seen.has(url)) continue;
    seen.add(url);
    let authorUrl: string | null = null;
    try {
      const author = new URL(textValue(row["author_url"]));
      if ((author.hostname === "linkedin.com" || author.hostname.endsWith(".linkedin.com")) && author.pathname.startsWith("/in/")) {
        authorUrl = `https://www.linkedin.com${author.pathname.replace(/\/+$/, "")}`;
      }
    } catch { /* infer profile from public post slug */ }
    const inferred = linkedinAuthorFromPost(url); authorUrl ??= inferred?.profile ?? null;
    posts.push({
      url, text: body, publishedAt: dateIso(row["published_at"]) || activityDate(url),
      authorName: textValue(row["author_name"]) || inferred?.name || null, authorUrl,
    });
  }
  return posts;
}
export function normalizeThreadsSearchPosts(payload: unknown): ThreadsPublicPost[] {
  if (!Array.isArray(payload)) return [];
  const seen = new Set<string>(); const posts: ThreadsPublicPost[] = [];
  for (const value of payload) {
    const row = record(value); if (!row) continue;
    const code = textValue(row["code"]);
    const username = textValue(row["username"]).replace(/^@/, "") || null;
    const fullName = textValue(row["full_name"]) || null;
    const body = textValue(row["text"]); const createdAt = dateIso(row["created_at"]);
    let url = textValue(row["url"]);
    if (!url && code && username) url = `https://www.threads.com/@${username}/post/${code}`;
    try {
      const parsed = new URL(url);
      if (!["threads.com", "www.threads.com", "threads.net", "www.threads.net"].includes(parsed.hostname.toLowerCase()) || !parsed.pathname.includes("/post/")) continue;
      url = `https://www.threads.com${parsed.pathname.replace(/\/+$/, "")}`;
    } catch { continue; }
    if (!code || !body || !createdAt || seen.has(url)) continue;
    seen.add(url); posts.push({ url, code, text: body, createdAt, username, fullName });
  }
  return posts;
}
export async function searchThreadsPublicPosts(keyword: string, options: { limit?: number } = {}): Promise<ThreadsPublicPost[]> {
  const term = keyword.trim(); if (!term) return [];
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 20)));
  const output = await runPython("threads_scraper.py", ["search", term, "--limit", String(limit)], 90_000);
  const posts = normalizeThreadsSearchPosts(parseJson(output));
  if (!posts.length) throw new Error("Threads returned no public keyword-search posts.");
  return posts;
}
export async function scrapeLinkedInPostUrls(urls: string[]): Promise<LinkedInPublicPost[]> {
  const safeUrls = [...new Set(urls.map(normalizeLinkedInPostUrl).filter((url): url is string => Boolean(url)))];
  if (!safeUrls.length) return [];
  const output = await runPython("scrape_linkedin_posts.py", safeUrls, Math.max(90_000, safeUrls.length * 25_000));
  return normalizeLinkedInScrapedPosts(parseJson(output));
}
export async function searchAndScrapeLinkedInPosts(
  competitor: { name: string; domain: string | null },
  options: { apply48HourFilter?: boolean; limit?: number } = {},
): Promise<LinkedInPublicPost[]> {
  const name = competitor.name.replace(/["']/g, "").replace(/\s+/g, " ").trim();
  if (!name) return [];
  const recent = options.apply48HourFilter ?? true;
  const limit = Math.max(1, Math.min(15, Math.floor(options.limit ?? 12)));
  const now = Date.now();
  const startDate = new Date(now - LINKEDIN_MAX_AGE_MS).toISOString().slice(0, 10);
  const endDate = new Date(now).toISOString().slice(0, 10);
  const tomorrow = new Date(Date.parse(endDate + "T00:00:00.000Z") + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const dateClauses = recent ? " after:" + startDate + " before:" + tomorrow : "";
  const queries = [
    "site:linkedin.com/posts " + name + dateClauses,
    "site:linkedin.com/feed/update " + name + dateClauses,
  ];
  const batches = await Promise.all(queries.map(query => searchLinkedInIndex(query, recent, startDate, endDate)));
  const successfulProviders = Array.from(new Set(batches.flatMap((batch) => batch.successfulProviders)));
  const providerResultCounts: LinkedInProviderResultCounts = {
    Google: batches.reduce((total, batch) => total + batch.providerResultCounts.Google, 0),
    "DuckDuckGo": batches.reduce((total, batch) => total + batch.providerResultCounts["DuckDuckGo"], 0),
    Bing: batches.reduce((total, batch) => total + batch.providerResultCounts.Bing, 0),
  };
  const successfulSearchRequests = batches.reduce((total, batch) => total + batch.successfulProviders.length, 0);
  const providerErrors = batches.flatMap(batch => batch.errors);
  if (successfulSearchRequests === 0) {
    throw new Error("LinkedIn search providers failed: " + (providerErrors.join("; ") || "no provider response"));
  }

  const hitsByUrl = new Map<string, LinkedInSearchHit>();
  for (const batch of batches) {
    for (const hit of batch.results) {
      const url = normalizeLinkedInPostUrl(hit.url);
      if (!url) continue;
      const previous = hitsByUrl.get(url);
      if (!previous) {
        hitsByUrl.set(url, {...hit, url});
      } else {
        const betterText = hit.snippet.length > previous.snippet.length ? hit : previous;
        const publishedAt = betterText.publishedAt || previous.publishedAt || hit.publishedAt;
        hitsByUrl.set(url, {
          ...betterText,
          url,
          ...(publishedAt ? { publishedAt } : {}),
        });
      }
    }
  }

  const posts: LinkedInPublicPost[] = [];
  let undated = 0;
  let outsideWindow = 0;
  let unreadablePreview = 0;
  for (const [url, hit] of hitsByUrl) {
    const title = hit.title.replace(/\s*(?:\||[-–—])\s*LinkedIn\s*$/i, "").trim();
    const snippet = hit.snippet.trim();
    const body = [title, snippet].filter(Boolean).join("\n").trim();
    if (body.length < 40) {
      unreadablePreview++;
      continue;
    }
    const publishedAt = parseLinkedInSearchDate(snippet + " " + hit.title, now) || hit.publishedAt || activityDate(url);
    if (recent && !publishedAt) {
      undated++;
      continue;
    }
    if (recent && !isLinkedInPostWithin48Hours(publishedAt, now)) {
      outsideWindow++;
      continue;
    }
    const inferred = linkedinAuthorFromPost(url);
    const authorFromTitle = hit.title.match(/^(.{2,80}?)\s+on LinkedIn\s*:/i);
    posts.push({
      url,
      text: body.slice(0, 5000),
      publishedAt,
      authorName: (authorFromTitle && authorFromTitle[1].trim()) || inferred?.name || null,
      authorUrl: inferred?.profile ?? null,
    });
    if (posts.length >= limit) break;
  }

  console.info("[LinkedIn] Search diagnostics", {
    competitor: name,
    queries,
    searchTimeWindow: recent ? {after:startDate, before:tomorrow, maxAgeHours:48} : "unrestricted",
    successfulProviders,
    successfulSearchRequests,
    providerResultCounts,
    providerErrors,
    indexedResults: batches.reduce((total, batch) => total + batch.results.length, 0),
    matchingPostUrls: hitsByUrl.size,
    sampleIndexedHits: batches.flatMap((batch) => batch.results).slice(0, 10).map((hit) => ({
      url: hit.url.slice(0, 400),
      normalizedPostUrl: normalizeLinkedInPostUrl(hit.url),
      title: hit.title.slice(0, 180),
      snippet: hit.snippet.slice(0, 240),
    })),
    readablePreviews: posts.length,
    undated,
    outside48Hours: outsideWindow,
    unreadablePreview,
  });
  return posts;
}

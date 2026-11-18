import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { linkedinAuthorFromPost } from "./pipeline";

const execFileAsync = promisify(execFile);
const SCRAPER_DIR = join(process.cwd(), "scripts", "toolzerhub");
const PYTHON = process.env["PYTHON_BIN"]?.trim() || (process.platform === "win32" ? "python" : "python3");

export interface LinkedInPublicPost {
  url: string; text: string; publishedAt: string; authorName: string | null; authorUrl: string | null;
}
export interface ThreadsPublicPost {
  url: string; code: string; text: string; createdAt: string; username: string | null; fullName: string | null;
}
interface LinkedInSearchHit {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
}

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
      const parsed = new URL(candidate, "https://www.google.com");
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
const LINKEDIN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LINKEDIN_SEARCH_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// A single headless Chromium instance and cookie-preserving context serve all competitor searches.
let linkedInBrowser: Browser | null = null;
let linkedInBrowserPromise: Promise<Browser> | null = null;
let linkedInGoogleContextPromise: Promise<BrowserContext> | null = null;

async function getLinkedInGoogleContext(): Promise<BrowserContext> {
  if (linkedInBrowser && !linkedInBrowser.isConnected()) {
    linkedInBrowser = null;
    linkedInBrowserPromise = null;
    linkedInGoogleContextPromise = null;
  }

  if (!linkedInBrowserPromise) {
    const executablePath = chromium.executablePath();
    if (!existsSync(executablePath)) {
      throw new Error(
        "Chromium executable is missing at " + executablePath +
          ". Check that Render installed Playwright Chromium into PLAYWRIGHT_BROWSERS_PATH.",
      );
    }
    console.info("[LinkedIn] Chromium executable verified", { executablePath });

    linkedInBrowserPromise = chromium
      .launch({
        headless: true,
        channel: "chromium",
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      })
      .then((browser) => {
        linkedInBrowser = browser;
        return browser;
      })
      .catch((error: unknown) => {
        linkedInBrowserPromise = null;
        throw new Error(
          "Could not launch headless Chromium for LinkedIn Google search: " +
            (error instanceof Error ? error.message : String(error)),
        );
      });
  }

  const browser = await linkedInBrowserPromise;
  if (!linkedInGoogleContextPromise) {
    linkedInGoogleContextPromise = browser
      .newContext({
        locale: "en-US",
        timezoneId: "UTC",
        viewport: { width: 1440, height: 1000 },
        userAgent: LINKEDIN_SEARCH_UA,
      })
      .catch((error: unknown) => {
        linkedInGoogleContextPromise = null;
        throw error;
      });
  }
  return linkedInGoogleContextPromise;
}

async function clickVisibleGoogleControl(page: Page, label: string): Promise<void> {
  const candidates = [
    page.getByRole("button", { name: label, exact: true }),
    page.getByRole("menuitem", { name: label, exact: true }),
    page.getByText(label, { exact: true }),
  ];

  for (const locator of candidates) {
    const count = await locator.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index--) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) continue;
      await candidate.click({ timeout: 7_000 });
      return;
    }
  }
  throw new Error('Google Search did not expose the "' + label + '" control.');
}

async function handleGoogleConsent(page: Page): Promise<void> {
  for (const label of ["Reject all", "Accept all", "I agree"]) {
    const button = page.getByRole("button", { name: label, exact: true }).last();
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      return;
    }
  }
}

function isGoogleSearchChallenge(text: string): boolean {
  return /our systems have detected unusual traffic|unusual traffic from your computer network|sorry\/index|not a robot|automated queries/i.test(
    text,
  );
}

async function applyGooglePast24HoursFilter(page: Page): Promise<void> {
  // Apply the filter through Google's visible controls; do not add date operators to the search text.
  await clickVisibleGoogleControl(page, "Tools");
  await page.waitForTimeout(250);
  await clickVisibleGoogleControl(page, "Any time");
  await page.waitForTimeout(150);
  await clickVisibleGoogleControl(page, "Past 24 hours");

  await page.waitForURL(
    (url) => (url.searchParams.get("tbs") ?? "").includes("qdr:d"),
    { timeout: 12_000 },
  ).catch(() => undefined);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(500);

  const appliedFilter = (new URL(page.url()).searchParams.get("tbs") ?? "").includes("qdr:d");
  if (!appliedFilter) {
    throw new Error(
      'Clicked Google Tools > Any time > Past 24 hours, but Google did not confirm the Past 24 hours filter.',
    );
  }
}

async function searchGoogleForLinkedInPosts(
  page: Page,
  competitorName: string,
  apply24HourFilter: boolean,
): Promise<LinkedInSearchHit[]> {
  const homeUrl = new URL("https://www.google.com/");
  homeUrl.searchParams.set("hl", "en");
  await page.goto(homeUrl.toString(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await handleGoogleConsent(page);

  const searchBox = page.locator('textarea[name="q"], input[name="q"]').first();
  await searchBox.waitFor({ state: "visible", timeout: 12_000 });
  await searchBox.fill(competitorName);
  await searchBox.press("Enter");
  await page.waitForURL(
    (url) => url.hostname.includes("google") && url.pathname.includes("/search"),
    { timeout: 18_000 },
  );
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await page.waitForTimeout(500);

  const initialBody = await page.locator("body").innerText().catch(() => "");
  if (isGoogleSearchChallenge(initialBody)) {
    throw new Error("Google Search returned an automated-traffic or verification challenge.");
  }

  if (apply24HourFilter) {
    await applyGooglePast24HoursFilter(page);
  }

  const resultCards = await page.locator("a:has(h3)").evaluateAll((anchors) =>
    anchors.map((node) => {
      const anchor = node as HTMLAnchorElement;
      const heading = anchor.querySelector("h3");
      const card = (
        anchor.closest("div.MjjYud") ??
        anchor.closest("div[data-hveid]") ??
        anchor.parentElement?.parentElement ??
        anchor.parentElement
      ) as HTMLElement | null;
      return {
        url: anchor.href,
        title: heading?.textContent?.trim() ?? "",
        snippet: card?.innerText?.replace(/\s+/g, " ").trim() ?? "",
      };
    }),
  ) as LinkedInSearchHit[];

  return resultCards
    .map((hit) => ({
      ...hit,
      url: unwrapSearchResultUrl(hit.url),
      publishedAt: parseLinkedInSearchDate(hit.snippet),
    }))
    .filter((hit) => Boolean(hit.url && hit.title));
}

export function parseLinkedInSearchDate(value: string, now = Date.now()): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";

  const relative = text.match(
    /(?:^|[|·•–—]\s*|\b(?:posted|published|created|updated)\s*(?:on|at|:)?\s*)(just now|moments ago|today|yesterday|\d{1,4}\s*(?:seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mo|years?|y)(?:\s*ago)?)(?=$|[\s|·•–—])/i,
  );
  if (relative?.[1]) {
    const label = relative[1].toLowerCase();
    if (label === "just now" || label === "moments ago" || label === "today") {
      return new Date(now).toISOString();
    }
    if (label === "yesterday") return new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const amountMatch = label.match(
      /(\d{1,4})\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|months?|mo|years?|y)/i,
    );
    if (amountMatch) {
      const amount = Number(amountMatch[1]);
      const unit = amountMatch[2]!.toLowerCase();
      const unitMs = /^(s|sec|secs|second|seconds)$/.test(unit) ? 1000
        : /^(m|min|mins|minute|minutes)$/.test(unit) ? 60 * 1000
        : /^(h|hr|hrs|hour|hours)$/.test(unit) ? 60 * 60 * 1000
        : /^(d|day|days)$/.test(unit) ? 24 * 60 * 60 * 1000
        : /^(w|week|weeks)$/.test(unit) ? 7 * 24 * 60 * 60 * 1000
        : /^(mo|month|months)$/.test(unit) ? 30 * 24 * 60 * 60 * 1000
        : 365 * 24 * 60 * 60 * 1000;
      return new Date(now - amount * unitMs).toISOString();
    }
  }

  const absolute = text.match(
    /(?:^|[|·•–—]\s*|\b(?:posted|published|created|updated)\s*(?:on|at|:)?\s*)(20\d{2}-\d{1,2}-\d{1,2}(?:[T ][0-9:.Z+-]+)?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:,?\s+20\d{2})?|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(?:\s+20\d{2})?)(?=$|[\s|·•–—])/i,
  );
  if (!absolute?.[1]) return "";
  const dateText = absolute[1];
  const normalizedDate = /\b20\d{2}\b/.test(dateText)
    ? dateText
    : dateText + ", " + new Date(now).getUTCFullYear();
  const parsed = new Date(normalizedDate);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function isLinkedInPostWithin24Hours(publishedAt: string, now: number): boolean {
  const timestamp = Date.parse(publishedAt);
  const age = now - timestamp;
  return Number.isFinite(timestamp) && age >= -5 * 60 * 1000 && age <= LINKEDIN_MAX_AGE_MS;
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
  options: { apply24HourFilter?: boolean; limit?: number } = {},
): Promise<LinkedInPublicPost[]> {
  const name = competitor.name.trim();
  if (!name) return [];

  const apply24HourFilter = options.apply24HourFilter ?? true;
  const limit = Math.max(1, Math.min(15, Math.floor(options.limit ?? 12)));
  const context = await getLinkedInGoogleContext();
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);

  try {
    const hits = await searchGoogleForLinkedInPosts(page, name, apply24HourFilter);
    const hitsByUrl = new Map<string, LinkedInSearchHit>();
    for (const hit of hits) {
      const url = normalizeLinkedInPostUrl(hit.url);
      if (!url) continue;
      const previous = hitsByUrl.get(url);
      if (!previous || hit.snippet.length > previous.snippet.length) {
        hitsByUrl.set(url, {...hit, url});
      } else if (!previous.publishedAt && hit.publishedAt) {
        hitsByUrl.set(url, {...previous, publishedAt: hit.publishedAt});
      }
    }

    const now = Date.now();
    const posts: LinkedInPublicPost[] = [];
    let undated = 0;
    let outside24Hours = 0;
    let unreadablePreview = 0;

    for (const [url, hit] of hitsByUrl) {
      const body = (hit.snippet || hit.title).replace(/\s+/g, " ").trim();
      if (body.length < 30) {
        unreadablePreview++;
        continue;
      }

      const publishedAt = parseLinkedInSearchDate(body, now) || hit.publishedAt || activityDate(url);
      if (apply24HourFilter && !publishedAt) {
        undated++;
        continue;
      }
      if (apply24HourFilter && !isLinkedInPostWithin24Hours(publishedAt, now)) {
        outside24Hours++;
        continue;
      }

      const inferred = linkedinAuthorFromPost(url);
      const authorFromTitle = hit.title.match(/^(.{2,80}?)\s+on LinkedIn\s*:/i);
      posts.push({
        url,
        text: body.slice(0, 5_000),
        publishedAt,
        authorName: authorFromTitle?.[1]?.trim() || inferred?.name || null,
        authorUrl: inferred?.profile ?? null,
      });
      if (posts.length >= limit) break;
    }

    console.info("[LinkedIn] Google UI search diagnostics", {
      competitor: name,
      query: name,
      timeFilter: apply24HourFilter ? "Tools > Any time > Past 24 hours" : "Any time (filter disabled)",
      browserMode: "headless",
      indexedResults: hits.length,
      matchingPostUrls: hitsByUrl.size,
      readablePosts: posts.length,
      undated,
      outside24Hours,
      unreadablePreview,
      sampleResults: hits.slice(0, 10).map((hit) => ({
        url: hit.url.slice(0, 350),
        title: hit.title.slice(0, 180),
        snippet: hit.snippet.slice(0, 260),
        publishedAt: hit.publishedAt ?? "",
      })),
    });

    return posts;
  } finally {
    await page.close().catch(() => undefined);
  }
}


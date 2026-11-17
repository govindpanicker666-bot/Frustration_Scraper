import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { webSearch } from "./search.server";
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

export function normalizeLinkedInPostUrl(value: unknown): string | null {
  try {
    const url = new URL(textValue(value));
    const host = url.hostname.toLowerCase();
    if (!["http:", "https:"].includes(url.protocol) || !(host === "linkedin.com" || host.endsWith(".linkedin.com"))) return null;
    if (!(url.pathname.startsWith("/posts/") || url.pathname.startsWith("/feed/update/"))) return null;
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`;
  } catch { return null; }
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
  const name = competitor.name.trim(); if (!name) return [];
  const recent = options.apply48HourFilter ?? true;
  const limit = Math.max(1, Math.min(15, Math.floor(options.limit ?? 12)));
  const after = recent ? ` after:${new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10)}` : "";
  const quotedName = `"${name.replace(/"/g, "").trim()}"`;
  const queries = [
    `site:linkedin.com/posts ${quotedName}${after}`,
    `site:linkedin.com/feed/update ${quotedName}${after}`,
  ];
  if (competitor.domain) {
    const domain = competitor.domain.toLowerCase().replace(/^www\./, "").split("/")[0];
    if (domain && domain !== name.toLowerCase()) queries.push(`site:linkedin.com/posts "${domain}"${after}`);
  }
  const batches = await Promise.all(queries.map((query) => webSearch(query, { recent, allSources: true })));
  const urls: string[] = []; const seen = new Set<string>();
  for (const batch of batches) {
    for (const hit of batch) {
      const url = normalizeLinkedInPostUrl(hit.url);
      if (!url || seen.has(url)) continue;
      seen.add(url); urls.push(url);
      if (urls.length >= limit) break;
    }
    if (urls.length >= limit) break;
  }
  return urls.length ? scrapeLinkedInPostUrls(urls) : [];
}

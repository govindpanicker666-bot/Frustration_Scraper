import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface LinkedInTestResult {
  ok: boolean;
  name: string;
  profileUrl: string | null;
  hasApiKey: boolean;
  searchRaw: unknown;
  profileRaw: unknown;
  error?: string | undefined;
}

export interface TikTokTestResult {
  ok: boolean;
  keyword: string;
  sessionUsed: boolean;
  videoUrl: string | null;
  videoId: string | null;
  searchRaw: unknown;
  commentsRaw: unknown;
  comments: unknown[];
  error?: string | undefined;
}

function parseJsonSafe(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

export async function testLinkedInSearch(name: string): Promise<LinkedInTestResult> {
  const queryName = name.trim();
  const hasJiroConfig = Boolean(
    process.env["JIRO_SEARCH_URL"]?.trim() ||
    process.env["JIROSEARCH_API_URL"]?.trim() ||
    process.env["JIROSEARCH_API_KEY"]?.trim(),
  );

  if (!queryName) {
    return {
      ok: false,
      name: queryName,
      profileUrl: null,
      hasApiKey: hasJiroConfig,
      searchRaw: null,
      profileRaw: null,
      error: "Missing 'name' query parameter.",
    };
  }

  const { scrapeJirosearch } = await import("@/lib/scrapers.server");
  const reviews = await scrapeJirosearch(queryName, ["linkedin"]);
  const firstWithProfile = reviews.find((r) => r.reviewer_profile_url) ?? reviews[0] ?? null;
  const profileUrl = firstWithProfile?.reviewer_profile_url ?? firstWithProfile?.source_url ?? null;

  return {
    ok: reviews.length > 0,
    name: queryName,
    profileUrl,
    hasApiKey: hasJiroConfig,
    searchRaw: reviews,
    profileRaw: firstWithProfile,
    error:
      reviews.length > 0
        ? undefined
        : hasJiroConfig
          ? "No LinkedIn posts returned by Jirosearch."
          : "JIRO_SEARCH_URL is not configured in environment variables.",
  };
}

function extractTikTokVideoFromPayload(
  payload: unknown,
): { videoId: string; videoUrl: string } | null {
  const visited = new Set<unknown>();

  function walk(node: unknown): { videoId: string; videoUrl: string } | null {
    if (!node || typeof node !== "object" || visited.has(node)) return null;
    visited.add(node);

    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }

    const rec = node as Record<string, unknown>;
    const itemObj = (rec["item"] as Record<string, unknown> | undefined) ?? rec;
    const id = itemObj["id"] ?? itemObj["aweme_id"];
    const author = itemObj["author"] as Record<string, unknown> | undefined;
    const hasVideoShape =
      Boolean(itemObj["aweme_id"]) ||
      Boolean(itemObj["video"] && typeof itemObj["video"] === "object") ||
      Boolean(author && typeof author === "object");
    const uniqueId = author?.["uniqueId"] ?? author?.["unique_id"];

    if (hasVideoShape && typeof id === "string" && /^\d{10,}$/.test(id)) {
      const handle = typeof uniqueId === "string" && uniqueId ? uniqueId : "tiktok";
      return {
        videoId: id,
        videoUrl: `https://www.tiktok.com/@${handle}/video/${id}`,
      };
    }

    for (const val of Object.values(rec)) {
      const found = walk(val);
      if (found) return found;
    }
    return null;
  }

  return walk(payload);
}

export async function testTikTokComments(
  keyword: string,
): Promise<TikTokTestResult | { error: string }> {
  const residentialProxyUrl = process.env["RESIDENTIAL_PROXY_URL"]?.trim();
  if (!residentialProxyUrl) {
    return {
      error: "TikTok requires a residential proxy. Please add RESIDENTIAL_PROXY_URL to .env",
    };
  }

  const term = keyword.trim();
  if (!term) {
    return {
      ok: false,
      keyword: term,
      sessionUsed: false,
      videoUrl: null,
      videoId: null,
      searchRaw: null,
      commentsRaw: null,
      comments: [],
      error: "Missing 'keyword' query parameter.",
    };
  }

  const { TikTokClient, PlaywrightSession } = await import("@traceryn/tiktok-sdk");
  const session = new PlaywrightSession({ headless: true, proxy: residentialProxyUrl });

  let videoUrl: string | null = null;
  let videoId: string | null = null;
  let searchRaw: unknown = null;
  let commentsRaw: unknown = null;
  let comments: unknown[] = [];

  try {
    await session.init();
    const client = new TikTokClient({
      session,
      proxy: residentialProxyUrl,
      timeout: 20_000,
      maxRetries: 1,
    });
    client.addProxies([residentialProxyUrl]);

    // 1. Search for a TikTok video matching the keyword via PlaywrightSession (--session WAF bypass)
    const searchAttempts: Array<{ endpoint: string; data?: unknown; error?: string }> = [];

    try {
      const generalSearch = await session.request<Record<string, unknown>>(
        "/api/search/general/full/",
        {
          keyword: term,
          offset: "0",
          count: "10",
          from_page: "search",
        },
      );
      searchAttempts.push({ endpoint: "/api/search/general/full/", data: generalSearch });
      const found = extractTikTokVideoFromPayload(generalSearch);
      if (found) {
        videoId = found.videoId;
        videoUrl = found.videoUrl;
      }
    } catch (err) {
      searchAttempts.push({
        endpoint: "/api/search/general/full/",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Fallback: load TikTok search page in Playwright browser and intercept video links/API
    if (!videoUrl && session.browser) {
      const context = await session.browser.newContext({
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
        locale: "en-US",
      });
      const page = await context.newPage();
      const intercepted: unknown[] = [];
      page.on("response", async (res) => {
        if (res.url().includes("/api/search/")) {
          try {
            intercepted.push(await res.json());
          } catch {
            // ignore non-json responses
          }
        }
      });

      try {
        await page.goto(`https://www.tiktok.com/search/video?q=${encodeURIComponent(term)}`, {
          waitUntil: "domcontentloaded",
          timeout: 25_000,
        });
        await page.waitForTimeout(5_000);

        const domLinks = await page.evaluate(() => {
          const anchors = Array.from(
            document.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'),
          );
          return anchors.map((a) => a.href).filter(Boolean);
        });

        searchAttempts.push({
          endpoint: "playwright:search/video",
          data: { domLinks: domLinks.slice(0, 10), intercepted },
        });

        const firstDomLink = domLinks[0];
        if (firstDomLink) {
          const match = firstDomLink.match(/\/video\/(\d+)/);
          if (match?.[1]) {
            videoUrl = firstDomLink;
            videoId = match[1];
          }
        }

        if (!videoUrl && intercepted.length > 0) {
          const found = extractTikTokVideoFromPayload(intercepted);
          if (found) {
            videoId = found.videoId;
            videoUrl = found.videoUrl;
          }
        }

        // 2b. Fallback to TikTok hashtag page (/tag/<keyword>) if search page is gated
        if (!videoUrl) {
          const tagSlug = term.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase();
          if (tagSlug) {
            const tagIntercepted: unknown[] = [];
            const onTagResponse = async (res: {
              url: () => string;
              json: () => Promise<unknown>;
            }) => {
              if (res.url().includes("/api/challenge/")) {
                try {
                  tagIntercepted.push(await res.json());
                } catch {
                  // ignore non-json
                }
              }
            };
            page.on("response", onTagResponse);
            await page.goto(`https://www.tiktok.com/tag/${encodeURIComponent(tagSlug)}`, {
              waitUntil: "domcontentloaded",
              timeout: 25_000,
            });
            await page.waitForTimeout(4_000);
            page.removeListener("response", onTagResponse);

            const tagDomLinks = await page.evaluate(() => {
              const anchors = Array.from(
                document.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'),
              );
              return anchors.map((a) => a.href).filter(Boolean);
            });

            searchAttempts.push({
              endpoint: `playwright:tag/${tagSlug}`,
              data: { domLinks: tagDomLinks.slice(0, 10), intercepted: tagIntercepted },
            });

            const firstTagLink = tagDomLinks[0];
            if (firstTagLink) {
              const match = firstTagLink.match(/\/video\/(\d+)/);
              if (match?.[1]) {
                videoUrl = firstTagLink;
                videoId = match[1];
              }
            }

            if (!videoUrl && tagIntercepted.length > 0) {
              const found = extractTikTokVideoFromPayload(tagIntercepted);
              if (found) {
                videoId = found.videoId;
                videoUrl = found.videoUrl;
              } else {
                const firstTagPayload = tagIntercepted[0] as
                  { challengeInfo?: { challenge?: { id?: string } } } | undefined;
                const challengeId = firstTagPayload?.challengeInfo?.challenge?.id;
                if (challengeId) {
                  try {
                    const challengeList = await session.request<Record<string, unknown>>(
                      "/api/challenge/item_list/",
                      {
                        aid: "1988",
                        challengeID: challengeId,
                        count: "10",
                        cursor: "0",
                      },
                    );
                    searchAttempts.push({
                      endpoint: "/api/challenge/item_list/",
                      data: challengeList,
                    });
                    const foundFromChallenge = extractTikTokVideoFromPayload(challengeList);
                    if (foundFromChallenge) {
                      videoId = foundFromChallenge.videoId;
                      videoUrl = foundFromChallenge.videoUrl;
                    }
                  } catch (err) {
                    searchAttempts.push({
                      endpoint: "/api/challenge/item_list/",
                      error: err instanceof Error ? err.message : String(err),
                    });
                  }
                }
              }
            }
          }
        }
      } catch (err) {
        searchAttempts.push({
          endpoint: "playwright:search/video",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await context.close().catch(() => {});
      }
    }

    searchRaw = searchAttempts;

    // 3. Fetch latest comments for the discovered video
    if (videoId && videoUrl) {
      const commentAttempts: Array<{ method: string; data?: unknown; error?: string }> = [];

      try {
        const sessionComments = await session.request<Record<string, unknown>>(
          "/api/comment/list/",
          {
            aid: "1988",
            aweme_id: videoId,
            count: "20",
            cursor: "0",
          },
        );
        commentAttempts.push({
          method: "session.request:/api/comment/list/",
          data: sessionComments,
        });
        const list = sessionComments["comments"];
        if (Array.isArray(list)) {
          comments = list;
        }
      } catch (err) {
        commentAttempts.push({
          method: "session.request:/api/comment/list/",
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (comments.length === 0) {
        try {
          const sdkComments = await client.getComments(videoUrl, 0, 20);
          commentAttempts.push({ method: "client.getComments", data: sdkComments });
          comments = sdkComments.comments;
        } catch (err) {
          commentAttempts.push({
            method: "client.getComments",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      commentsRaw = commentAttempts;
    }

    return {
      ok: Boolean(videoUrl) && comments.length > 0,
      keyword: term,
      sessionUsed: true,
      videoUrl,
      videoId,
      searchRaw,
      commentsRaw,
      comments,
      error: !videoUrl
        ? "Could not locate a TikTok video for the given keyword (may be blocked or require residential proxy/login)."
        : comments.length === 0
          ? "Located video, but no comments were returned."
          : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      keyword: term,
      sessionUsed: true,
      videoUrl,
      videoId,
      searchRaw,
      commentsRaw,
      comments,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await session.close().catch(() => {});
  }
}

export interface MediaScraperTestResult {
  ok: boolean;
  platform: "x" | "instagram" | "facebook";
  library: string;
  query: string;
  discoveredUrls: string[];
  searchResults: Array<{ title: string; url: string; snippet: string }>;
  scraped: Array<{ url: string; ok: boolean; data?: unknown; error?: string | undefined }>;
  error?: string | undefined;
}

async function runMediaScraperSearch(
  platform: "x" | "instagram" | "facebook",
  library: string,
  query: string,
  searchQueries: string[],
  urlFilter: (url: string) => boolean,
  scraperFn: (url: string) => Promise<unknown>,
): Promise<MediaScraperTestResult> {
  const term = query.trim();
  if (!term) {
    return {
      ok: false,
      platform,
      library,
      query: term,
      discoveredUrls: [],
      searchResults: [],
      scraped: [],
      error: "Missing 'query' parameter.",
    };
  }

  let discoveredUrls: string[] = [];
  const searchResults: Array<{ title: string; url: string; snippet: string }> = [];

  if (urlFilter(term)) {
    discoveredUrls = [term];
  } else {
    const { webSearch } = await import("@/lib/search.server");
    const seen = new Set<string>();
    for (const q of searchQueries) {
      const hits = await webSearch(q, { recent: true });
      for (const hit of hits) {
        if (urlFilter(hit.url) && !seen.has(hit.url)) {
          seen.add(hit.url);
          discoveredUrls.push(hit.url);
          searchResults.push({ title: hit.title, url: hit.url, snippet: hit.snippet });
        }
      }
      if (discoveredUrls.length >= 3) break;
    }
    discoveredUrls = discoveredUrls.slice(0, 3);
  }

  if (discoveredUrls.length === 0) {
    return {
      ok: false,
      platform,
      library,
      query: term,
      discoveredUrls: [],
      searchResults,
      scraped: [],
      error: `No matching ${platform} post URLs found for "${term}" via web search.`,
    };
  }

  const scraped: Array<{ url: string; ok: boolean; data?: unknown; error?: string | undefined }> =
    [];
  for (const targetUrl of discoveredUrls) {
    try {
      const data = await scraperFn(targetUrl);
      scraped.push({ url: targetUrl, ok: true, data });
    } catch (err) {
      scraped.push({
        url: targetUrl,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const anySucceeded = scraped.some((item) => item.ok);
  const firstError = scraped.find((item) => !item.ok)?.error;

  return {
    ok: anySucceeded,
    platform,
    library,
    query: term,
    discoveredUrls,
    searchResults,
    scraped,
    error: anySucceeded ? undefined : firstError,
  };
}

export async function testXSearch(query: string): Promise<MediaScraperTestResult> {
  const scrapeXMod = await import("media-scraper/x");
  const scrapeX = scrapeXMod.default;
  const term = query.trim();
  return runMediaScraperSearch(
    "x",
    "media-scraper/x (xpull unavailable on npm: 404 Not Found)",
    term,
    [
      `site:x.com/*/status/ "${term}"`,
      `site:twitter.com/*/status/ "${term}"`,
      `site:x.com ${term} status`,
    ],
    (u) => /^https?:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/i.test(u),
    scrapeX,
  );
}

export async function testInstagramSearch(query: string): Promise<MediaScraperTestResult> {
  const scrapeInstagramMod = await import("media-scraper/instagram");
  const scrapeInstagram = scrapeInstagramMod.default;
  const term = query.trim();
  return runMediaScraperSearch(
    "instagram",
    "media-scraper/instagram",
    term,
    [
      `site:instagram.com/p/ "${term}"`,
      `site:instagram.com/reel/ "${term}"`,
      `site:instagram.com "${term}"`,
    ],
    (u) =>
      /^https?:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel|reels)\/[A-Za-z0-9_-]+/i.test(
        u,
      ),
    scrapeInstagram,
  );
}

export async function testFacebookSearch(query: string): Promise<MediaScraperTestResult> {
  const scrapeFacebookMod = await import("media-scraper/facebook");
  const scrapeFacebook = scrapeFacebookMod.default;
  const term = query.trim();
  return runMediaScraperSearch(
    "facebook",
    "media-scraper/facebook",
    term,
    [
      `site:facebook.com/*/videos/ "${term}"`,
      `site:facebook.com/reel/ "${term}"`,
      `site:facebook.com/*/posts/ "${term}"`,
      `site:facebook.com/watch/ "${term}"`,
    ],
    (u) =>
      /^https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch)\/(?:[^/]+\/(?:videos|posts)\/|reel\/|watch\/|share\/|permalink\.php)/i.test(
        u,
      ),
    scrapeFacebook,
  );
}

export interface ThreadsTestResult {
  ok: boolean;
  keyword: string;
  command: string;
  stdout: string;
  stderr: string;
  parsedStdout: unknown;
  totalRows: number;
  results: Array<Record<string, string>>;
  error?: string | undefined;
}

function parseCsvRecords(csvText: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (csvText[i + 1] === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      currentRow.push(currentField);
      currentField = "";
    } else if (ch === "\r") {
      if (csvText[i + 1] === "\n") i++;
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
    } else if (ch === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  if (rows.length < 2) return [];
  const headers = rows[0] ?? [];
  const out: Array<Record<string, string>> = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || (row.length === 1 && row[0] === "")) continue;
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c] ?? `col_${c}`;
      record[key] = row[c] ?? "";
    }
    out.push(record);
  }

  return out;
}

export async function testThreadsScraper(
  keyword: string,
  opts: { limit?: number } = {},
): Promise<ThreadsTestResult> {
  const term = keyword.trim();
  const command = `threads-scraper --keywords "${term}"`;
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit ?? 15)));

  if (!term) {
    return {
      ok: false,
      keyword: term,
      command,
      stdout: "",
      stderr: "",
      parsedStdout: null,
      totalRows: 0,
      results: [],
      error: "Missing 'keyword' query parameter.",
    };
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "threads-scraper-"));
  const outputCsvPath = path.join(tempDir, "output.csv");
  const args = [
    "--keywords",
    term,
    "--output",
    outputCsvPath,
    "--limit",
    String(limit),
    "--delay-min",
    "0.5",
    "--delay-max",
    "1.5",
    "--no-checkpoint",
  ];

  try {
    const { stdout, stderr } = await execFileAsync("threads-scraper", args, {
      cwd: tempDir,
      env: process.env,
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    const parsedStdout = parseJsonSafe(stdout);
    let results: Array<Record<string, string>> = [];

    try {
      const csvRaw = await readFile(outputCsvPath, "utf8");
      results = parseCsvRecords(csvRaw);
    } catch {
      // output.csv is only created when at least 1 post passes filters
    }

    const combinedOutput = `${stdout}\n${stderr}`;
    const blockMatch = combinedOutput.match(/(captcha|login|checkpoint|403|blocked|challenge)/i);

    return {
      ok: results.length > 0,
      keyword: term,
      command,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      parsedStdout,
      totalRows: results.length,
      results,
      error:
        results.length > 0
          ? undefined
          : blockMatch
            ? `Blocked or gated (${blockMatch[0]}): ${combinedOutput.trim()}`
            : "threads-scraper completed with 0 comments saved.",
    };
  } catch (err) {
    const execErr = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const stdout = typeof execErr.stdout === "string" ? execErr.stdout.trim() : "";
    const stderr = typeof execErr.stderr === "string" ? execErr.stderr.trim() : "";
    const parsedStdout = parseJsonSafe(stdout);
    const errorDetail = stderr || stdout || execErr.message || String(err);

    return {
      ok: false,
      keyword: term,
      command,
      stdout,
      stderr,
      parsedStdout,
      totalRows: 0,
      results: [],
      error: errorDetail,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

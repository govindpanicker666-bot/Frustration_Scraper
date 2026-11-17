import { parseDdgHtml, parseBingRss, type SearchResult } from "./pipeline";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export type { SearchResult };

async function ddg(query: string, recent: boolean): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}${recent ? "&df=w" : ""}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000) },
    );
    return response.ok ? parseDdgHtml(await response.text()) : [];
  } catch { return []; }
}
async function bing(query: string, recent: boolean): Promise<SearchResult[]> {
  try {
    const response = await fetch(
      `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}${recent ? "&filters=" + encodeURIComponent('ex1:"ez2"') : ""}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000) },
    );
    return response.ok ? parseBingRss(await response.text()) : [];
  } catch { return []; }
}

/** Free public web search; allSources merges DuckDuckGo and Bing instead of returning the first hit set. */
export async function webSearch(
  query: string,
  opts: { recent?: boolean; allSources?: boolean } = {},
): Promise<SearchResult[]> {
  if (opts.allSources) {
    const [duck, bingResults] = await Promise.all([
      ddg(query, !!opts.recent),
      bing(query, !!opts.recent),
    ]);
    const seen = new Set<string>();
    return [...duck, ...bingResults].filter((result) => {
      if (!result.url || seen.has(result.url)) return false;
      seen.add(result.url);
      return true;
    });
  }
  const results = await ddg(query, !!opts.recent);
  return results.length ? results : bing(query, !!opts.recent);
}

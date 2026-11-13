// Free web search: DuckDuckGo HTML first, Bing public RSS as fallback. No AI, no keys.
import { parseDdgHtml, parseBingRss, type SearchResult } from "./pipeline";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
export type { SearchResult };

async function ddg(query: string, recent: boolean): Promise<SearchResult[]> {
  try {
    const r = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}${recent ? "&df=w" : ""}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000) },
    );
    return r.ok ? parseDdgHtml(await r.text()) : [];
  } catch {
    return [];
  }
}
async function bing(query: string, recent: boolean): Promise<SearchResult[]> {
  try {
    const r = await fetch(
      `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}${recent ? "&filters=" + encodeURIComponent('ex1:"ez2"') : ""}`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(9000) },
    );
    return r.ok ? parseBingRss(await r.text()) : [];
  } catch {
    return [];
  }
}

/** Web search with automatic fallback. Returns [] when both are unavailable. */
export async function webSearch(
  query: string,
  opts: { recent?: boolean } = {},
): Promise<SearchResult[]> {
  const a = await ddg(query, !!opts.recent);
  if (a.length) return a;
  return bing(query, !!opts.recent);
}

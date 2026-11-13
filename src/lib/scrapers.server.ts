import {
  exactQuery,
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

// ---------- Reddit (public search JSON) ----------
async function reddit(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  type P = {
    data: {
      author: string;
      title: string;
      selftext: string;
      permalink: string;
      created_utc: number;
    };
  };
  const queryUrl = apply48HourFilter
    ? `https://www.reddit.com/search.json?q=${encodeURIComponent(exactQuery(c.name))}&sort=new&t=week&limit=50`
    : `https://www.reddit.com/search.json?q=${encodeURIComponent(exactQuery(c.name))}&sort=relevance&t=all&limit=100`;
  const j = await getJson<{ data: { children: P[] } }>(queryUrl, {
    headers: { "User-Agent": "Churnhound/1.0 (lead research)" },
  });
  return j.data.children.map(({ data: p }): RawReview => {
    const url = `https://www.reddit.com${p.permalink}`;
    return {
      platform: "reddit",
      reviewer_name: p.author,
      reviewer_profile_url: `https://www.reddit.com/user/${p.author}`,
      source_url: url,
      text: `${p.title}. ${p.selftext}`.slice(0, 3000),
      published_at: new Date(p.created_utc * 1000).toISOString(),
    };
  });
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
  const query = apply48HourFilter
    ? `site:${site} "${c.name}" ${COMPLAINT_TERMS}`
    : `site:${site} "${c.name}"`;
  const res = await webSearch(query, { recent: apply48HourFilter });
  // Search engines only return results from the past week when recent=true; we stamp them as now so the 48h filter keeps them,
  // and URL de-duplication stops the same post being saved twice on later days.
  const now = new Date().toISOString();
  const host = site.split("/")[0]!;
  return res
    .filter((r) => r.url.includes(host) || (host === "x.com" && r.url.includes("twitter.com")))
    .map((r) => ({
      url: r.url,
      author: r.title.split(/ on (?:LinkedIn|X)| \| | - /)[0]!.trim(),
      text: `${r.title}. ${r.snippet}`,
      date: now,
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
async function linkedin(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const { linkedinAuthorFromPost } = await import("./pipeline");
  const posts = await indexed(c, "linkedin.com/posts", opts);
  return posts
    .filter((p) => /linkedin\.com\/(posts|pulse)\//.test(p.url))
    .map((p): RawReview => {
      const a = linkedinAuthorFromPost(p.url);
      return {
        platform: "linkedin",
        reviewer_name: p.author || a?.name || null,
        reviewer_profile_url: a?.profile ?? p.url,
        source_url: p.url.split("?")[0]!,
        text: p.text,
        published_at: p.date,
      };
    });
}
async function x(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const posts = await indexed(c, "x.com", opts);
  const out: RawReview[] = [];
  for (const p of posts
    .filter((p) => /(x|twitter)\.com\/[^/]+\/status\/\d+/.test(p.url))
    .slice(0, 10)) {
    let name = p.author,
      text = p.text;
    try {
      const o = await getJson<{ author_name: string; html: string }>(
        `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(p.url)}`,
      );
      name = o.author_name || name;
      text =
        stripHtml(o.html.replace(/<a[^>]*>(?:pic\.twitter|https?:\/\/t\.co)[\s\S]*?<\/a>/g, ""))
          .replace(/— .*$/, "")
          .trim() || text;
    } catch {
      /* deleted/protected tweet: keep search snippet */
    }
    const handle = p.url.match(/\.com\/([^/]+)\/status/)![1];
    out.push({
      platform: "x",
      reviewer_name: name || `@${handle}`,
      reviewer_profile_url: `https://x.com/${handle}`,
      source_url: p.url.split("?")[0]!.replace("twitter.com", "x.com"),
      text,
      published_at: p.date,
    });
  }
  return out;
}

// ---------- Newer free sources ----------
/** Search-index posts for any of several sites; results are past-week only and stamped now (48h filter + URL dedupe). */
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
  const q = `(${sites.map((s) => `site:${s}`).join(" OR ")}) "${c.name}" ${effectiveExtra}`.trim();
  const now = new Date().toISOString();
  const res = (await webSearch(q, { recent: apply48HourFilter })).filter((r) => urlRe.test(r.url));
  return res.map((r) => ({
    url: r.url.split("#")[0]!,
    title: r.title,
    text: `${r.title}. ${r.snippet}`,
    date: now,
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
async function youtube(c: CompetitorCtx, opts: ScrapePlatformOptions = {}) {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  // Comments for recent review/alternative videos via the public watch page's embedded data.
  const spParam = apply48HourFilter ? "&sp=EgIIBA%253D%253D" : "";
  const query = apply48HourFilter ? `${c.name} review alternative` : `${c.name} review`;
  const r = await get(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}${spParam}`,
  );
  if (!r.ok) throw new Blocked(`youtube ${r.status}`);
  const maxVideos = apply48HourFilter ? 5 : 8;
  const ids = [
    ...new Set([...(await r.text()).matchAll(/"videoId":"([\w-]{11})"/g)].map((m) => m[1]!)),
  ].slice(0, maxVideos);
  if (!ids.length) throw new NoMatch("no videos");
  const out: RawReview[] = [];
  for (const id of ids) {
    try {
      const html = await (await get(`https://www.youtube.com/watch?v=${id}`)).text();
      const title = html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(/ - YouTube$/, "") ?? "";
      if (!new RegExp(c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(title)) continue;
      const desc = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1] ?? "";
      const date =
        html.match(/"publishDate":"([^"]+)"/)?.[1] ??
        html.match(/itemprop="datePublished" content="([^"]+)"/)?.[1];
      const author = html.match(/"ownerChannelName":"([^"]+)"/)?.[1] ?? null;
      const chan = html.match(/"canonicalBaseUrl":"(\/@[^"]+)"/)?.[1];
      out.push({
        platform: "youtube",
        reviewer_name: author,
        reviewer_profile_url: chan ? `https://www.youtube.com${chan}` : null,
        source_url: `https://www.youtube.com/watch?v=${id}`,
        text: `${title}. ${JSON.parse(`"${desc}"`).slice(0, 1500)}`,
        published_at: iso(date),
      });
    } catch {
      /* skip video */
    }
  }
  return out;
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
  return scrapeThreadsReviews(c.name, { limit: apply48HourFilter ? 15 : 50 });
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
};

export async function scrapePlatform(
  c: CompetitorCtx,
  platform: Platform,
  opts: ScrapePlatformOptions = {},
): Promise<SourceResult> {
  const apply48HourFilter = opts.apply48HourFilter ?? true;
  try {
    const all = await SOURCES[platform](c, opts);
    const reviews = all.filter(
      (r) =>
        r.text &&
        r.source_url &&
        (platform === "threads"
          ? !Number.isNaN(new Date(r.published_at).getTime()) &&
            Boolean(r.reviewer_name && r.reviewer_name !== "[deleted]")
          : keepReview(r, undefined, { skipRecencyCheck: !apply48HourFilter })),
    );
    return { status: "ok", reviews };
  } catch (e) {
    console.warn("source", platform, e instanceof Error ? e.message : e);
    if (e instanceof NoMatch) return { status: "no_match", reviews: [] };
    if (e instanceof Error && e.message === "no_key") return { status: "no_key", reviews: [] };
    return { status: "blocked", reviews: [] };
  }
}

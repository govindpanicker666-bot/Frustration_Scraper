import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAppSupabaseAuth } from "@/lib/supabase-auth";
import {
  domainOf,
  extractNewsPicks,
  feedCandidates,
  newsPageCandidates,
  normalizeNewsType,
  parseFeed,
  parseNewsHtml,
  type NormalizedNewsPick,
} from "./pipeline";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { insightsStale } from "./pipeline";

/** Our own company: name, site and what it does (homepage meta), so AI output fits our business. */
async function ourCompany(supabase: SupabaseClient<Database>, userId: string) {
  const { data: p } = await supabase
    .from("profiles")
    .select("company_name,company_url")
    .eq("id", userId)
    .maybeSingle();
  let about = "";
  if (p?.company_url) {
    try {
      const url = /^https?:/i.test(p.company_url) ? p.company_url : `https://${p.company_url}`;
      const html = await (
        await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(6000),
        })
      ).text();
      const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
      const d =
        html.match(
          /<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']+)/i,
        )?.[1] ?? "";
      about = `${t} — ${d}`.trim();
    } catch {
      /* unreachable */
    }
  }
  return {
    name: p?.company_name || p?.company_url || "our company",
    url: p?.company_url ?? "",
    about,
  };
}

/** Cached strategic recommendations. Only regenerated when the lead count changed, or on force. */
export const getRecommendations = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ force: z.boolean().default(false) }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    // Only leads for the competitors currently tracked; older ones stay on the Leads page only.
    const { data: cur } = await sb.from("competitors").select("id").eq("user_id", context.userId);
    const curIds = (cur ?? []).map((c) => c.id);
    const [{ data: cache }, { data: leads }] = await Promise.all([
      sb.from("insight_cache").select("*").eq("user_id", context.userId).maybeSingle(),
      sb
        .from("leads")
        .select("competitor_name,extracted_complaint,review_text")
        .eq("user_id", context.userId)
        .in("competitor_id", curIds.length ? curIds : ["00000000-0000-0000-0000-000000000000"])
        .gte("sentiment_score", 1)
        .order("date_scraped", { ascending: false })
        .limit(300),
    ]);
    const count = leads?.length ?? 0;
    const cached = cache
      ? {
          recommendations: (cache.recommendations as string[]) ?? [],
          generated_at: cache.generated_at,
        }
      : null;
    if (!data.force && cache && !insightsStale(cache, count))
      return { ...cached!, error: null as string | null };
    if (!count)
      return { recommendations: [] as string[], generated_at: null as string | null, error: null };
    const tally = new Map<string, number>();
    for (const l of leads!) {
      const k = `${l.extracted_complaint ?? "Other"} (${l.competitor_name})`;
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    const us = await ourCompany(sb, context.userId);
    try {
      const { geminiJson } = await import("./ai.server");
      const out = await geminiJson<{ recommendations: string[] }>(
        "You are a sharp B2B go-to-market strategist. Be specific to the business, never generic.",
        `We are ${us.name} (${us.url}). What we do: ${us.about || "see name/site"}.\nTop complaints customers have about our competitors (with mention counts):\n${top.map(([c, n]) => `- ${c}: ${n}`).join("\n")}\n\nGive 3 short, concrete recommendations for OUR sales and marketing team to win these frustrated customers. Name the competitor and the specific angle. Return {"recommendations":["..."]}`,
      );
      const recs = (out.recommendations ?? []).filter((x) => typeof x === "string").slice(0, 3);
      const generated_at = new Date().toISOString();
      await sb.from("insight_cache").upsert({
        user_id: context.userId,
        recommendations: recs,
        lead_count: count,
        generated_at,
      });
      return { recommendations: recs, generated_at, error: null };
    } catch (e) {
      console.error("recommendations", e);
      return {
        recommendations: cached?.recommendations ?? [],
        generated_at: cached?.generated_at ?? null,
        error: "Could not generate new recommendations right now.",
      };
    }
  });

export interface ContentIdeaBlogTitle {
  title: string;
  angle: string;
}

export interface ContentIdeaSocialHook {
  hook: string;
  platform: string;
  angle: string;
}

export const generateContentIdeas = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        complaints: z.array(z.string().min(1).max(200)).max(5).optional(),
        complaint: z.string().min(1).max(200).optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const us = await ourCompany(context.supabase, context.userId);
    const { data: comps } = await context.supabase
      .from("competitors")
      .select("id,name,category,description")
      .eq("user_id", context.userId)
      .limit(60);
    const compIds = (comps ?? []).map((c) => c.id);
    const { data: leads } = await context.supabase
      .from("leads")
      .select("competitor_name,extracted_complaint,review_text")
      .eq("user_id", context.userId)
      .in("competitor_id", compIds.length ? compIds : ["00000000-0000-0000-0000-000000000000"])
      .gte("sentiment_score", 1)
      .order("date_scraped", { ascending: false })
      .limit(300);

    const tally = new Map<string, { count: number; quotes: string[] }>();
    for (const l of leads ?? []) {
      const key = (l.extracted_complaint ?? "").trim();
      if (!key) continue;
      const entry = tally.get(key) ?? { count: 0, quotes: [] };
      entry.count += 1;
      if (entry.quotes.length < 2 && l.review_text) {
        entry.quotes.push(`${l.competitor_name}: "${l.review_text.slice(0, 220)}"`);
      }
      tally.set(key, entry);
    }

    const dbTop5 = [...tally.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 5);

    const complaintsUsed =
      dbTop5.length > 0
        ? dbTop5.map(([c]) => c)
        : data.complaints?.length
          ? data.complaints.slice(0, 5)
          : data.complaint
            ? [data.complaint]
            : [];

    const complaintBlock =
      dbTop5.length > 0
        ? dbTop5
            .map(
              ([c, info], idx) =>
                `${idx + 1}. "${c}" (${info.count} mentions)${
                  info.quotes.length ? `\n   Quotes: ${info.quotes.join(" | ")}` : ""
                }`,
            )
            .join("\n")
        : complaintsUsed.map((c, idx) => `${idx + 1}. "${c}"`).join("\n") || "(no complaints yet)";

    const { geminiJson } = await import("./ai.server");
    try {
      const out = await geminiJson<{
        blog_titles?: ContentIdeaBlogTitle[];
        social_hooks?: ContentIdeaSocialHook[];
      }>(
        "You are a senior B2B SaaS content strategist. Ideas must speak directly to the company's industry, product, and frustrated competitor buyers; never return generic filler.",
        `Our company: ${us.name} (${us.url}). What we do: ${us.about || "infer from name/site"}.
Competitors: ${(comps ?? []).map((c) => `${c.name} (${c.category ?? ""})`).join(", ")}.

Here are the top 5 complaints users have about our competitors:
${complaintBlock}

Here are the top 5 complaints users have about our competitors. Generate 3 catchy Blog Post titles AND 3 short Social Media hooks (for LinkedIn/Twitter) that we can use to attract users frustrated by these issues. Do not focus on just one complaint; mix them.
Return JSON:
{"blog_titles":[{"title":"","angle":"one short line explaining why it resonates"}],"social_hooks":[{"hook":"","platform":"LinkedIn" or "Twitter","angle":"one short line explaining why it resonates"}]}`,
      );

      const blogTitles = (out.blog_titles ?? [])
        .filter((b): b is ContentIdeaBlogTitle => Boolean(b?.title?.trim()))
        .slice(0, 3);
      const socialHooks = (out.social_hooks ?? [])
        .filter((s): s is ContentIdeaSocialHook => Boolean(s?.hook?.trim()))
        .slice(0, 3);

      return {
        blog_titles: blogTitles,
        social_hooks: socialHooks,
        complaints_used: complaintsUsed,
        error: null as string | null,
      };
    } catch (e) {
      console.error("content ideas", e);
      return {
        blog_titles: [] as ContentIdeaBlogTitle[],
        social_hooks: [] as ContentIdeaSocialHook[],
        complaints_used: complaintsUsed,
        error: "Could not generate ideas right now.",
      };
    }
  });

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type NewsFeedItem = { title: string; link: string; summary: string; date: string };

function normalizeNewsUrlKey(raw: string): string {
  return raw.trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
}

function extractAlternateFeedHref(html: string): string | null {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1] ?? "";
    if (!/application\/(?:rss|atom)\+xml/i.test(type)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href) return href;
  }
  return null;
}

async function firstSuccessful<T>(
  urls: string[],
  worker: (url: string) => Promise<T | null>,
  concurrency = 4,
): Promise<T | null> {
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const settled = await Promise.all(batch.map((u) => worker(u)));
    const hit = settled.find((item) => item !== null);
    if (hit !== undefined && hit !== null) return hit;
  }
  return null;
}

async function findFeed(domain: string): Promise<NewsFeedItem[] | null> {
  const tryFeedUrl = async (u: string): Promise<NewsFeedItem[] | null> => {
    try {
      const r = await fetch(u, {
        headers: {
          "User-Agent": UA,
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) return null;
      const items = parseFeed(await r.text(), r.url || u);
      return items.length ? items : null;
    } catch {
      return null;
    }
  };

  let resolvedHost = domain;
  for (const origin of [`https://${domain}`, `https://www.${domain.replace(/^www\./, "")}`]) {
    try {
      const r = await fetch(origin, {
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) continue;
      try {
        resolvedHost = new URL(r.url || origin).hostname;
      } catch {
        /* keep default */
      }
      const href = extractAlternateFeedHref(await r.text());
      if (href) {
        const items = await tryFeedUrl(new URL(href, r.url || origin).toString());
        if (items) return items;
      }
      break;
    } catch {
      /* try next origin */
    }
  }

  const feedHit = await firstSuccessful(feedCandidates(resolvedHost), tryFeedUrl, 4);
  if (feedHit) return feedHit;

  const htmlUrls =
    resolvedHost === domain
      ? [
          ...newsPageCandidates(domain),
          ...newsPageCandidates(`www.${domain.replace(/^www\./, "")}`),
        ]
      : newsPageCandidates(resolvedHost);

  return firstSuccessful(
    htmlUrls,
    async (u) => {
      try {
        const r = await fetch(u, {
          headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok) return null;
        const items = parseNewsHtml(await r.text(), r.url || u);
        return items.length ? items : null;
      } catch {
        return null;
      }
    },
    4,
  );
}

async function searchCompetitorNewsFallback(
  name: string,
  domain: string | null,
): Promise<NewsFeedItem[]> {
  const { webSearch } = await import("./search.server");
  const queries = domain
    ? [
        `site:${domain} (blog OR news OR changelog OR release OR pricing OR launch)`,
        `"${name}" (launch OR pricing OR funding OR announcement OR partnership)`,
      ]
    : [`"${name}" (launch OR pricing OR funding OR announcement OR partnership)`];

  for (const q of queries) {
    const hits = await webSearch(q, { recent: true });
    const filtered = hits
      .filter((h) => h.title.trim().length >= 8 && /^https?:\/\//i.test(h.url))
      .slice(0, 5)
      .map((h) => ({
        title: h.title.trim(),
        link: h.url,
        summary: h.snippet.trim(),
        date: "",
      }));
    if (filtered.length > 0) return filtered;
  }
  return [];
}

const requireNewsSupabaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { createClient } = await import("@supabase/supabase-js");
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import("@/integrations/supabase/constants");

  const request = getRequest();
  const authHeader = request?.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized: Please sign in again.");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token || token.split(".").length !== 3) {
    throw new Error("Unauthorized: Invalid session token.");
  }

  const supabaseUrl = SUPABASE_URL.trim().replace(/\/+$/, "");
  const supabaseAnonKey = SUPABASE_ANON_KEY.trim();

  const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  let userId: string | undefined;
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
  userId = claimsData?.claims?.sub;
  if (claimsErr || !userId) {
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData.user?.id) {
      throw new Error("Unauthorized: Invalid token");
    }
    userId = userData.user.id;
  }

  return next({
    context: {
      supabase,
      userId,
    },
  });
});

export const refreshCompetitorNews = createServerFn({ method: "POST" })
  .middleware([requireNewsSupabaseAuth])
  .handler(async ({ context }) => {
    let comps: Array<{ id: string; name: string; url: string | null; domain?: string | null }> = [];
    const primary = await context.supabase
      .from("competitors")
      .select("id,name,url,domain")
      .eq("user_id", context.userId);
    if (primary.error) {
      if (primary.error.code === "42703" || primary.error.code === "PGRST204") {
        const fallback = await context.supabase
          .from("competitors")
          .select("id,name,url")
          .eq("user_id", context.userId);
        if (fallback.error) {
          throw new Error(fallback.error.message || "Could not load competitors.");
        }
        comps = (fallback.data ?? []).map((c) => ({ ...c, domain: null }));
      } else {
        throw new Error(primary.error.message || "Could not load competitors.");
      }
    } else {
      comps = primary.data ?? [];
    }

    if (comps.length === 0) {
      return {
        results: [] as Array<{ name: string; status: "ok" | "no_feed"; saved: number }>,
        saved: 0,
        reason: "no_competitors" as const,
      };
    }

    type PoolEntry = NewsFeedItem & { comp: { id: string; name: string } };
    const perCompPools: PoolEntry[][] = [];
    const results: Array<{ name: string; status: "ok" | "no_feed"; saved: number }> = [];

    for (let i = 0; i < comps.length; i += 6) {
      const batch = comps.slice(i, i + 6);
      const batchOut = await Promise.all(
        batch.map(async (c) => {
          const domain = domainOf((c.domain ?? "").trim() || c.url);
          let items = domain ? (await findFeed(domain))?.slice(0, 5) : null;
          if (!items?.length) {
            const searched = await searchCompetitorNewsFallback(c.name, domain);
            if (searched.length) items = searched;
          }
          if (!items?.length) {
            return {
              result: { name: c.name, status: "no_feed" as const, saved: 0 },
              entries: [] as PoolEntry[],
            };
          }
          return {
            result: { name: c.name, status: "ok" as const, saved: 0 },
            entries: items.map((it) => ({ comp: { id: c.id, name: c.name }, ...it })),
          };
        }),
      );
      for (const item of batchOut) {
        results.push(item.result);
        if (item.entries.length) perCompPools.push(item.entries);
      }
    }

    // Balance round-robin across competitors and deduplicate by canonical URL before AI selection.
    const pool: PoolEntry[] = [];
    const seenUrls = new Set<string>();
    const maxPerComp = Math.max(0, ...perCompPools.map((arr) => arr.length));
    for (let depth = 0; depth < maxPerComp && pool.length < 42; depth++) {
      for (const list of perCompPools) {
        const entry = list[depth];
        if (!entry) continue;
        const key = normalizeNewsUrlKey(entry.link);
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);
        pool.push(entry);
        if (pool.length >= 42) break;
      }
    }

    if (!pool.length) {
      return { results, saved: 0, reason: "no_sources" as const };
    }

    // One AI pass picks the 5-7 most useful posts (or up to pool.length if fewer).
    const { geminiJson } = await import("./ai.server");
    const targetCount = Math.min(7, pool.length);
    let picks: NormalizedNewsPick[] = [];
    try {
      const out = await geminiJson<unknown>(
        "You are a competitive-intelligence analyst briefing a B2B sales team.",
        `From these competitor posts pick the ${targetCount} most strategically useful updates (prioritize funding, pricing changes, major launches, outages, layoffs, acquisitions, partnerships, and leadership changes; if few of those appear, pick the best product updates, new capabilities, or market moves). Because posts are provided, always return between 1 and ${targetCount} items and never return an empty results array. For each give: index (the [N] integer), summary (what happened, 1 sentence), type (funding|pr|pricing|product|other), why_it_matters (1 sentence: impact on us / their customers), tactical_advice (1 concrete sales move). Return {"results":[{"index":0,"summary":"","type":"other","why_it_matters":"","tactical_advice":""}]}\n\n${pool.map((p, i) => `[${i}] ${p.comp.name}: ${p.title}\n${p.summary.slice(0, 300)}`).join("\n\n")}`,
      );
      picks = extractNewsPicks(out, pool.length);
    } catch (e) {
      console.error("news ai", e);
      throw new Error("AI is unavailable right now, so news insights couldn't be generated.");
    }

    if (picks.length === 0) {
      // Safety net if the model returned an empty array despite non-empty pool.
      const pickedComps = new Set<string>();
      const fallbackIndices: number[] = [];
      for (let i = 0; i < pool.length && fallbackIndices.length < Math.min(5, pool.length); i++) {
        if (!pickedComps.has(pool[i]!.comp.id)) {
          pickedComps.add(pool[i]!.comp.id);
          fallbackIndices.push(i);
        }
      }
      for (let i = 0; i < pool.length && fallbackIndices.length < Math.min(5, pool.length); i++) {
        if (!fallbackIndices.includes(i)) fallbackIndices.push(i);
      }
      picks = fallbackIndices.map((idx) => {
        const item = pool[idx]!;
        return {
          index: idx,
          summary: item.summary ? item.summary.slice(0, 220) : item.title,
          type: "product",
          why_it_matters: `${item.comp.name} recently published "${item.title}", signaling active product or GTM focus.`,
          tactical_advice: `Reference ${item.comp.name}'s update in outreach to compare how your solution covers this workflow without added complexity.`,
        };
      });
    }

    const rowUrls = new Set<string>();
    const rows = picks
      .map((a) => {
        const it = pool[a.index]!;
        const key = normalizeNewsUrlKey(it.link);
        if (rowUrls.has(key)) return null;
        rowUrls.add(key);
        const d = it.date ? new Date(it.date) : null;
        return {
          user_id: context.userId,
          competitor_id: it.comp.id,
          competitor_name: it.comp.name,
          title: it.title,
          url: it.link,
          summary: a.summary || it.summary || it.title,
          news_type: normalizeNewsType(a.type),
          why_it_matters: a.why_it_matters || null,
          tactical_advice: a.tactical_advice || null,
          published_date: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length === 0) {
      return { results, saved: 0, reason: "no_sources" as const };
    }

    const { error: delError } = await context.supabase
      .from("competitor_news")
      .delete()
      .eq("user_id", context.userId);
    if (delError) {
      console.error("competitor_news delete error:", delError);
      throw new Error(delError.message || "Could not refresh competitor news.");
    }

    let { error: insertError } = await context.supabase.from("competitor_news").insert(rows);
    if (
      insertError &&
      (insertError.code === "42703" || insertError.code === "PGRST204") &&
      /why_it_matters/i.test(insertError.message ?? "")
    ) {
      const legacyRows = rows.map(({ why_it_matters: _ignored, ...rest }) => rest);
      const retry = await context.supabase.from("competitor_news").insert(legacyRows);
      insertError = retry.error;
    }
    if (insertError) {
      console.error("competitor_news insert error:", insertError);
      throw new Error(insertError.message || "Could not save competitor news.");
    }

    return { results, saved: rows.length, reason: null as string | null };
  });

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  domainOf,
  feedCandidates,
  newsPageCandidates,
  parseFeed,
  parseNewsHtml,
  type NewsType,
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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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
async function findFeed(domain: string) {
  const tryUrl = async (u: string) => {
    try {
      const r = await fetch(u, {
        headers: {
          "User-Agent": UA,
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      const items = parseFeed(await r.text());
      return items.length ? items : null;
    } catch {
      return null;
    }
  };
  try {
    const html = await (
      await fetch(`https://${domain}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(8000),
      })
    ).text();
    const href =
      html.match(
        /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)/i,
      )?.[1] ??
      html.match(
        /<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/(?:rss|atom)\+xml/i,
      )?.[1];
    if (href) {
      const items = await tryUrl(new URL(href, `https://${domain}`).toString());
      if (items) return items;
    }
  } catch {
    /* homepage unreachable */
  }
  for (const u of feedCandidates(domain)) {
    const items = await tryUrl(u);
    if (items) return items;
  }
  // No feed: read the HTML blog/news pages directly.
  for (const u of [
    ...newsPageCandidates(domain),
    ...newsPageCandidates(`www.${domain.replace(/^www\./, "")}`),
  ]) {
    try {
      const r = await fetch(u, {
        headers: { "User-Agent": UA, Accept: "text/html" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const items = parseNewsHtml(await r.text(), r.url || u);
      if (items.length) return items;
    } catch {
      /* try next */
    }
  }
  return null;
}

export const refreshCompetitorNews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: comps } = await context.supabase
      .from("competitors")
      .select("id,name,url,domain")
      .eq("user_id", context.userId);
    const pool: {
      comp: { id: string; name: string };
      title: string;
      link: string;
      summary: string;
      date: string;
    }[] = [];
    const results = await Promise.all(
      (comps ?? []).map(async (c) => {
        const domain = c.domain ?? domainOf(c.url);
        const items = domain ? (await findFeed(domain))?.slice(0, 5) : null;
        if (!items?.length) return { name: c.name, status: "no_feed" as const, saved: 0 };
        for (const it of items) pool.push({ comp: c, ...it });
        return { name: c.name, status: "ok" as const, saved: 0 };
      }),
    );
    if (!pool.length) return { results, saved: 0 };

    // One AI pass picks only the 5-7 posts that matter strategically.
    const { geminiJson } = await import("./ai.server");
    type Pick = {
      index: number;
      summary: string;
      type: NewsType;
      why_it_matters: string;
      tactical_advice: string;
    };
    let picks: Pick[] = [];
    try {
      const out = await geminiJson<{ results: Pick[] }>(
        "You are a competitive-intelligence analyst briefing a sales team. Skip routine content (tutorials, tips, generic blog posts, customer stories, webinars).",
        `From these competitor posts pick ONLY the 5-7 most strategically important (funding, pricing changes, major launches, outages, layoffs, acquisitions, partnerships, leadership changes). For each give: summary (what happened, 1 sentence), type (funding|pr|pricing|product|other), why_it_matters (1 sentence: impact on us / their customers), tactical_advice (1 concrete sales move). Return {"results":[{"index":0,"summary":"","type":"other","why_it_matters":"","tactical_advice":""}]}\n\n${pool.map((p, i) => `[${i}] ${p.comp.name}: ${p.title}\n${p.summary.slice(0, 300)}`).join("\n\n")}`,
      );
      picks = (out.results ?? []).filter((p) => pool[p.index]).slice(0, 7);
    } catch (e) {
      console.error("news ai", e);
      throw new Error("AI is unavailable right now, so news insights couldn't be generated.");
    }
    const rows = picks.map((a) => {
      const it = pool[a.index]!;
      const d = new Date(it.date);
      return {
        user_id: context.userId,
        competitor_id: it.comp.id,
        competitor_name: it.comp.name,
        title: it.title,
        url: it.link,
        summary: a.summary,
        news_type: a.type ?? "other",
        why_it_matters: a.why_it_matters,
        tactical_advice: a.tactical_advice,
        published_date: Number.isNaN(d.getTime()) ? null : d.toISOString(),
      };
    });
    await context.supabase.from("competitor_news").delete().eq("user_id", context.userId);
    const { error } = await context.supabase.from("competitor_news").insert(rows);
    if (error) console.error(error);
    return { results, saved: error ? 0 : rows.length };
  });

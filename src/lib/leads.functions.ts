import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { domainOf } from "./pipeline";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireAppSupabaseAuth } from "@/lib/supabase-auth";
import { PLATFORMS, stripHtml, type Platform, type RawReview } from "./pipeline";

export interface DetectedCompetitor {
  name: string;
  url: string;
  category: string;
  description?: string;
  keywords?: string[];
}

export const detectCompetitors = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_url: z.string().min(3).max(300),
        company_name: z.string().max(200).optional(),
        description: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { geminiJson } = await import("./ai.server");
    const { saveCompanyProfileToDb } = await import("./brand-listening.server");
    const emailClaim =
      context.claims && typeof context.claims["email"] === "string"
        ? context.claims["email"]
        : null;
    await saveCompanyProfileToDb(context.supabase, context.userId, {
      company_name: data.company_name ?? null,
      company_url: data.company_url,
      emailHint: emailClaim,
      preserveEmptyName: true,
    });
    const url = /^https?:/i.test(data.company_url)
      ? data.company_url
      : `https://${data.company_url}`;
    let site = "";
    try {
      const r = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      const html = await r.text();
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "";
      const desc =
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ?? "";
      const og =
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1] ??
        "";
      site = `OG: ${og}\nTitle: ${title}\nDescription: ${desc}\nText: ${stripHtml(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")).slice(0, 3000)}`;
    } catch {
      /* site unreachable; rely on search */
    }
    const host = url.replace(/^https?:\/\//, "").split("/")[0];
    const prompt = `Our company: ${data.company_name ?? "(unknown)"} — ${url}\nFounder's own description: ${data.description?.trim() || "(none given)"}\nHomepage content:\n${site || "(could not load — rely on the description and your market knowledge)"}\n\nFirst work out exactly what this company sells and to whom. If it is a new or unknown startup, rely on the founder's description and think of products solving the same problem for the same buyer. Then, using your own market knowledge, list real, currently operating DIRECT competitors (products a buyer would evaluate instead of ours). You MUST return AT LEAST 40 competitors (minimum 40, never fewer). Include direct competitors first, then the closest adjacent products the same buyer would evaluate, until you reach at least 40. Well-known market leaders in the same category count. Do not include our own company. Return {"competitors":[{"name":"","url":"https://official-site","category":"short category","description":"one line","keywords":["3-5 distinctive words used to recognise posts about this product"]}]}`;
    const sys =
      "You are a precise B2B market analyst with deep knowledge of software and SaaS markets. Always return at least 40 competitors.";
    try {
      const out = await geminiJson<{ competitors: DetectedCompetitor[] }>(sys, prompt);
      return {
        competitors: (out.competitors ?? [])
          .filter(
            (c, i, a) =>
              c?.name &&
              a.findIndex((x) => x?.name?.toLowerCase() === c.name.toLowerCase()) === i &&
              (!c.url || domainOf(c.url) !== (host ?? "").replace(/^www\./, "")),
          )
          .slice(0, 60),
        error: null as string | null,
      };
    } catch (e) {
      console.error("detectCompetitors", e);
      return {
        competitors: [] as DetectedCompetitor[],
        error: "AI could not suggest competitors right now. Please try again.",
      };
    }
  });

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Admins only");
}

const platformIds = PLATFORMS.map((p) => p.id) as [Platform, ...Platform[]];
const platformSchema = z.enum(platformIds);

export const scrapeReviews = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        competitor_id: z.string().uuid(),
        platform: z.union([platformSchema, z.literal("all")]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { scrapeCore } = await import("./run.server");
    return scrapeCore(context.supabase, data.competitor_id, data.platform);
  });

const rawSchema = z.object({
  platform: platformSchema,
  reviewer_name: z.string().nullable(),
  reviewer_profile_url: z.string().nullable(),
  source_url: z.string(),
  text: z.string(),
  published_at: z.string(),
});

export const analyzeAndEnrich = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ competitor_id: z.string().uuid(), reviews: z.array(rawSchema).max(60) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { analyzeCore } = await import("./run.server");
    return analyzeCore(context.supabase, data.competitor_id, data.reviews);
  });

export const generatePitchMessage = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ lead_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: l } = await context.supabase
      .from("leads")
      .select("*")
      .eq("id", data.lead_id)
      .single();
    if (!l) throw new Error("Lead not found");
    const { data: prof } = await context.supabase
      .from("profiles")
      .select("company_name,company_url")
      .eq("id", context.userId)
      .maybeSingle();
    const channel = l.email
      ? "a short cold email (subject line + 4-6 sentence body)"
      : l.linkedin_url
        ? "a LinkedIn connection note UNDER 300 characters"
        : `a friendly public reply on ${l.source_platform} (2-3 sentences, not salesy)`;
    const { geminiJson } = await import("./ai.server");
    try {
      const out = await geminiJson<{ message: string }>(
        "You write warm, specific, non-spammy outreach for a founder.",
        `We are ${prof?.company_name ?? "our company"} (${prof?.company_url ?? ""}), an alternative to ${l.competitor_name}.\nRecipient: ${l.reviewer_name ?? "there"}${l.job_title ? `, ${l.job_title}` : ""}${l.company ? ` at ${l.company}` : ""}.\nTheir post: "${l.review_text.slice(0, 1200)}"\nCore complaint: ${l.extracted_complaint}\nWrite ${channel}. Reference their actual complaint, empathise, and offer one concrete way we solve it. No placeholders like [Name]. Return {"message":""}`,
      );
      const message = out.message?.trim() ?? "";
      await context.supabase.from("leads").update({ pitch_message: message }).eq("id", l.id);
      return { message, error: null as string | null };
    } catch (e) {
      console.error("pitch", e);
      return { message: "", error: "AI could not write a message right now. Please try again." };
    }
  });

const settingsSchema = z.object({
  enabled: z.boolean(),
  run_hour: z.number().int().min(0).max(23),
});

export const getScrapeSettings = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_scrape_settings")
      .select("enabled,run_hour,last_run_at,progress,pause_reason")
      .eq("user_id", context.userId)
      .maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    const p = (data?.progress ?? null) as {
      date: string;
      competitors: number;
      found: number;
      saved: number;
    } | null;
    return {
      enabled: data?.enabled ?? false,
      run_hour: data?.run_hour ?? 6,
      last_run_at: data?.last_run_at ?? null,
      pause_reason: data?.pause_reason ?? null,
      last_result: p?.date === today ? p : null,
    };
  });

export const updateScrapeSettings = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) => settingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("user_scrape_settings").upsert(
      {
        user_id: context.userId,
        ...data,
        ...(data.enabled ? { pause_reason: null } : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(error.message || "Could not save settings");
    return { ok: true };
  });

export type { RawReview };

export const reenrichContacts = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ lead_ids: z.array(z.string().uuid()).max(20).nullable() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { reenrichLeads } = await import("./run.server");
    // RLS limits this to the caller's own leads.
    return reenrichLeads(
      context.supabase,
      data.lead_ids,
      data.lead_ids ? data.lead_ids.length : 10,
    );
  });

export const getCompanyProfile = createServerFn({ method: "GET" })
  .middleware([requireAppSupabaseAuth])
  .handler(async ({ context }) => {
    const { readCompanyProfile } = await import("./brand-listening.server");
    const emailClaim =
      context.claims && typeof context.claims["email"] === "string"
        ? context.claims["email"]
        : null;
    return readCompanyProfile(context.supabase, context.userId, emailClaim);
  });

export const saveCompanyProfile = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        company_name: z.string().trim().max(200).default(""),
        company_url: z.string().trim().max(300).default(""),
      })
      .refine((v) => v.company_name.length > 0 || v.company_url.length > 0, {
        message: "Enter your company name or website URL",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { saveCompanyProfileToDb } = await import("./brand-listening.server");
    const emailClaim =
      context.claims && typeof context.claims["email"] === "string"
        ? context.claims["email"]
        : null;
    return saveCompanyProfileToDb(context.supabase, context.userId, {
      company_name: data.company_name,
      company_url: data.company_url,
      emailHint: emailClaim,
      preserveEmptyName: false,
    });
  });

export const getTutorialStatus = createServerFn({ method: "GET" })
  .middleware([requireAppSupabaseAuth])
  .handler(async ({ context }) => {
    const { readTutorialStatus } = await import("./tutorial.server");
    return readTutorialStatus(context.supabase, context.userId);
  });

export const markTutorialSeen = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .handler(async ({ context }) => {
    const { markTutorialSeenInDb } = await import("./tutorial.server");
    const emailClaim =
      context.claims && typeof context.claims["email"] === "string"
        ? context.claims["email"]
        : null;
    return markTutorialSeenInDb(context.supabase, context.userId, emailClaim);
  });

export const syncMyFullName = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ full_name: z.string().trim().min(1).max(120) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { syncProfileFullNameInDb } = await import("./account.server");
    const emailClaim =
      context.claims && typeof context.claims["email"] === "string"
        ? context.claims["email"]
        : null;
    return syncProfileFullNameInDb(context.supabase, context.userId, data.full_name, emailClaim);
  });

export const syncPendingSignupName = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        full_name: z.string().trim().min(1).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { syncPendingSignupProfileInDb } = await import("./account.server");
    return syncPendingSignupProfileInDb(data.user_id, data.full_name);
  });

export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .handler(async ({ context }) => {
    const { deleteUserAccountInDb } = await import("./account.server");
    return deleteUserAccountInDb(context.userId);
  });

export const submitUserFeedback = createServerFn({ method: "POST" })
  .middleware([requireAppSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        type: z.enum(["feedback", "error"]),
        subject: z.string().trim().min(2, "Please enter a brief subject").max(120),
        details: z.string().trim().min(5, "Please add a few more details").max(2000),
        pagePath: z.string().trim().max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { submitUserFeedbackInDb } = await import("./account.server");
    const emailClaim =
      context.claims && typeof context.claims["email"] === "string"
        ? context.claims["email"]
        : undefined;
    return submitUserFeedbackInDb(context.supabase, context.userId, {
      type: data.type,
      subject: data.subject,
      details: data.details,
      pagePath: data.pagePath,
      userEmail: emailClaim,
    });
  });

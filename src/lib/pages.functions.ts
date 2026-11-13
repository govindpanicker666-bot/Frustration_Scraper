import { createServerFn } from "@tanstack/react-start";
import { notFound } from "@tanstack/react-router";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DB = SupabaseClient<Database>;
async function assertAdmin(sb: DB, userId: string) {
  const { data } = await sb.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!data) throw new Error("Forbidden");
}
function publicClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type PageBlock = { id?: string; block_type: string; content: Record<string, unknown> };

export const listPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data } = await context.supabase
      .from("custom_pages")
      .select("id,title,slug,status,created_at,updated_at")
      .order("updated_at", { ascending: false });
    return data ?? [];
  });

export const createPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("custom_pages")
      .insert({ title: "Untitled page", slug: `page-${Date.now().toString(36)}` })
      .select("id")
      .single();
    if (error || !data) throw new Error("Could not create page");
    return data;
  });

export const getPageForEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: page } = await context.supabase
      .from("custom_pages")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!page) throw new Error("Page not found");
    const { data: blocks } = await context.supabase
      .from("page_blocks")
      .select("id,block_type,content,order_index")
      .eq("page_id", data.id)
      .order("order_index");
    return {
      page,
      blocks: (blocks ?? []).map((b) => ({
        id: b.id,
        block_type: b.block_type,
        content: (b.content ?? {}) as { [k: string]: Json },
      })),
    };
  });

const saveSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug: lowercase letters, numbers and dashes"),
  seo_description: z.string().max(320).nullable(),
  status: z.enum(["draft", "published"]),
  blocks: z
    .array(z.object({ block_type: z.string().max(40), content: z.record(z.string(), z.unknown()) }))
    .max(80),
});
export const savePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => saveSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase;
    const { error } = await sb
      .from("custom_pages")
      .update({
        title: data.title,
        slug: data.slug,
        seo_description: data.seo_description,
        status: data.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error)
      return {
        ok: false,
        error:
          error.code === "23505"
            ? "That slug is already used by another page."
            : "Could not save page.",
      };
    await sb.from("page_blocks").delete().eq("page_id", data.id);
    if (data.blocks.length) {
      const { error: be } = await sb.from("page_blocks").insert(
        data.blocks.map((b, i) => ({
          page_id: data.id,
          block_type: b.block_type,
          content: b.content as Json,
          order_index: i,
        })),
      );
      if (be) return { ok: false, error: "Page saved but blocks failed to save." };
    }
    return { ok: true, error: null as string | null };
  });

export const deletePage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    await context.supabase.from("custom_pages").delete().eq("id", data.id);
    return { ok: true };
  });

export const listPageSubmissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data } = await context.supabase
      .from("page_submissions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    return data ?? [];
  });

/** Public: a published page with its blocks. */
export const getPublishedPage = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ slug: z.string().max(120) }).parse(d))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: page } = await sb
      .from("custom_pages")
      .select("id,title,slug,seo_description")
      .eq("slug", data.slug)
      .eq("status", "published")
      .maybeSingle();
    if (!page) throw notFound();
    const { data: blocks } = await sb
      .from("page_blocks")
      .select("id,block_type,content,order_index")
      .eq("page_id", page.id)
      .order("order_index");
    return {
      page,
      blocks: (blocks ?? []).map((b) => ({
        id: b.id,
        block_type: b.block_type,
        content: (b.content ?? {}) as { [k: string]: Json },
      })),
    };
  });

/** Public: anonymised real complaints about a competitor (no names, emails or links). */
export const getPublicReviews = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z
      .object({ competitor: z.string().min(1).max(200), limit: z.number().int().min(1).max(12) })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("leads")
      .select(
        "id,review_text,extracted_complaint,source_platform,sentiment_score,reviewer_name,date_scraped",
      )
      .ilike("competitor_name", data.competitor)
      .gte("sentiment_score", 1)
      .order("sentiment_score", { ascending: false })
      .limit(data.limit);
    return (rows ?? []).map((r) => ({
      id: r.id,
      text: r.review_text.slice(0, 500),
      complaint: r.extracted_complaint,
      platform: r.source_platform,
      score: r.sentiment_score,
      author: (r.reviewer_name ?? "Verified user").split(/\s+/)[0]!.slice(0, 30),
      date: r.date_scraped,
    }));
  });

/** Public: lead capture form submission. */
export const submitPageLead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        page_id: z.string().uuid(),
        name: z.string().trim().max(120).optional(),
        email: z.string().trim().email().max(255),
        company: z.string().trim().max(160).optional(),
        message: z.string().trim().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: page } = await supabaseAdmin
      .from("custom_pages")
      .select("id")
      .eq("id", data.page_id)
      .eq("status", "published")
      .maybeSingle();
    if (!page) return { ok: false };
    const { error } = await supabaseAdmin.from("page_submissions").insert({
      page_id: data.page_id,
      name: data.name || null,
      email: data.email,
      company: data.company || null,
      message: data.message || null,
    });
    return { ok: !error };
  });

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

function isMissingSchemaError(
  err: { code?: string | undefined; message?: string | undefined } | null | undefined,
): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = err.message ?? "";
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    /does not exist|could not find the .* column|schema cache/i.test(msg)
  );
}

function isForeignKeyDeleteError(
  err:
    | { code?: string | undefined; message?: string | undefined; status?: number | undefined }
    | null
    | undefined,
): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  const msg = err.message ?? "";
  return (
    code === "23503" || /foreign key|violates|database error deleting user|constraint/i.test(msg)
  );
}

function isPlaceholderValue(val: string | undefined): boolean {
  if (!val) return true;
  const trimmed = val.trim();
  return !trimmed || /placeholder/i.test(trimmed);
}

async function resolveAdminDb(fallbackDb?: DB): Promise<DB> {
  if (process.env["VITEST"] || process.env["NODE_ENV"] === "test") {
    if (fallbackDb) return fallbackDb;
  }
  const url = process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (isPlaceholderValue(url) || isPlaceholderValue(key)) {
    if (fallbackDb) return fallbackDb;
    throw new Error("Account service is not configured (missing Supabase admin credentials).");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function syncProfileFullNameInDb(
  db: DB,
  userId: string,
  fullName: string,
  emailHint?: string | null,
): Promise<{ ok: true; saved: boolean }> {
  const trimmed = fullName.trim();
  if (!trimmed) return { ok: true, saved: false };

  const writeDb = await resolveAdminDb(db);
  const { data: updated, error: updateErr } = await writeDb
    .from("profiles")
    .update({ full_name: trimmed })
    .eq("id", userId)
    .select("id");

  if (updateErr) {
    if (isMissingSchemaError(updateErr)) {
      return { ok: true, saved: false };
    }
    console.warn("[Account] profiles full_name update warning:", updateErr.message);
    return { ok: true, saved: false };
  }

  if (!updated || updated.length === 0) {
    const email = (emailHint ?? "").trim() || `${userId}@users.local`;
    const { error: upsertErr } = await writeDb
      .from("profiles")
      .upsert({ id: userId, email, full_name: trimmed }, { onConflict: "id" });

    if (upsertErr) {
      if (!isMissingSchemaError(upsertErr)) {
        console.warn("[Account] profiles full_name upsert warning:", upsertErr.message);
      }
      return { ok: true, saved: false };
    }
  }

  return { ok: true, saved: true };
}

export async function syncPendingSignupProfileInDb(
  userId: string,
  fullName: string,
  adminClient?: DB,
): Promise<{ ok: true; saved: boolean }> {
  const trimmed = fullName.trim();
  if (!trimmed) return { ok: true, saved: false };

  const admin = adminClient ?? (await resolveAdminDb());
  const { data: userRes, error: getUserErr } = await admin.auth.admin.getUserById(userId);
  if (getUserErr || !userRes?.user) {
    return { ok: true, saved: false };
  }

  const meta = (userRes.user.user_metadata ?? {}) as Record<string, unknown>;
  const metaFullName = typeof meta["full_name"] === "string" ? meta["full_name"].trim() : "";
  if (metaFullName !== trimmed) {
    return { ok: true, saved: false };
  }

  return syncProfileFullNameInDb(admin, userId, trimmed, userRes.user.email ?? null);
}

const USER_OWNED_TABLES = [
  "leads",
  "competitors",
  "brand_mentions",
  "ai_brand_insights",
  "ai_visibility_scans",
  "competitor_news",
  "insight_cache",
  "user_scrape_settings",
  "user_roles",
] as const;

async function cleanupUserOwnedData(admin: DB, userId: string): Promise<void> {
  try {
    await admin.from("blog_posts").update({ created_by: null }).eq("created_by", userId);
  } catch {
    /* ignore if blog_posts doesn't exist or created_by is null */
  }

  for (const table of USER_OWNED_TABLES) {
    try {
      await admin.from(table).delete().eq("user_id", userId);
    } catch {
      /* ignore missing table / schema drift */
    }
  }

  try {
    await admin.from("profiles").delete().eq("id", userId);
  } catch {
    /* ignore */
  }
}

export async function deleteUserAccountInDb(
  userId: string,
  adminClient?: DB,
): Promise<{ ok: true }> {
  if (!userId.trim()) {
    throw new Error("Missing user ID.");
  }

  const admin = adminClient ?? (await resolveAdminDb());

  // Detach nullable author references on shared blog posts before deleting auth user.
  try {
    await admin.from("blog_posts").update({ created_by: null }).eq("created_by", userId);
  } catch {
    /* ignore */
  }

  let { error } = await admin.auth.admin.deleteUser(userId);
  if (error && isForeignKeyDeleteError(error)) {
    await cleanupUserOwnedData(admin, userId);
    const retry = await admin.auth.admin.deleteUser(userId);
    error = retry.error;
  }

  if (error) {
    console.error("[Account] deleteUser error:", error.message);
    throw new Error(error.message || "Failed to delete account.");
  }

  return { ok: true };
}

export interface FeedbackSubmissionInput {
  type: "feedback" | "error";
  subject: string;
  details: string;
  pagePath?: string | undefined;
  userEmail?: string | undefined;
}

export async function submitUserFeedbackInDb(
  db: DB,
  userId: string,
  input: FeedbackSubmissionInput,
): Promise<{ ok: true }> {
  const writeDb = await resolveAdminDb(db);
  const tag = input.type === "error" ? "Error Report" : "Feedback";
  const email = input.userEmail?.trim() || `${userId}@users.local`;
  const page = input.pagePath?.trim() || "/";
  const body = `[${tag}] ${input.subject.trim()}\nPage: ${page}\n\n${input.details.trim()}`;

  let storedInSubmissions = false;
  try {
    const { error: subErr } = await writeDb.from("page_submissions").insert({
      page_id: null,
      name: `[${tag}] ${input.subject.trim().slice(0, 100)}`,
      email,
      company: page.slice(0, 160),
      message: body.slice(0, 2000),
    });
    if (!subErr) {
      storedInSubmissions = true;
    } else if (!isMissingSchemaError(subErr)) {
      console.warn("[Account] page_submissions feedback warning:", subErr.message);
    }
  } catch {
    /* fall through to user_scrape_settings backup log */
  }

  // Always also record in user_scrape_settings.progress.feedback_log as resilient backup.
  try {
    const { data: settingsRow } = await writeDb
      .from("user_scrape_settings")
      .select("progress")
      .eq("user_id", userId)
      .maybeSingle();

    const prevProgress =
      settingsRow?.progress &&
      typeof settingsRow.progress === "object" &&
      !Array.isArray(settingsRow.progress)
        ? (settingsRow.progress as Record<string, unknown>)
        : {};

    const prevList = Array.isArray(prevProgress["feedback_log"])
      ? prevProgress["feedback_log"]
      : [];

    const entry = {
      type: input.type,
      subject: input.subject.trim(),
      details: input.details.trim(),
      page,
      created_at: new Date().toISOString(),
    };

    const nextProgress = {
      ...prevProgress,
      feedback_log: [...prevList.slice(-19), entry],
    };

    await writeDb.from("user_scrape_settings").upsert(
      {
        user_id: userId,
        progress: nextProgress as unknown as Json,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  } catch (err) {
    if (!storedInSubmissions) {
      throw new Error(err instanceof Error ? err.message : "Could not save feedback.");
    }
  }

  return { ok: true };
}

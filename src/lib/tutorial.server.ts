import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

type DB = SupabaseClient<Database>;

function isMissingSchemaError(
  err: { code?: string; message?: string } | null | undefined,
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

function parseEnvelope(progress: Json | null | undefined): Record<string, unknown> {
  if (!progress || typeof progress !== "object" || Array.isArray(progress)) return {};
  return progress as Record<string, unknown>;
}

async function getAdminOrUserDb(fallbackDb: DB): Promise<DB> {
  if (process.env["VITEST"] || process.env["NODE_ENV"] === "test") {
    return fallbackDb;
  }
  const hasUrl = Boolean(process.env["SUPABASE_URL"] || process.env["VITE_SUPABASE_URL"]);
  const hasKey = Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!hasUrl || !hasKey) {
    return fallbackDb;
  }
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return supabaseAdmin;
  } catch {
    return fallbackDb;
  }
}

export async function readTutorialStatus(
  db: DB,
  userId: string,
): Promise<{ has_seen_tutorial: boolean }> {
  const readDb = await getAdminOrUserDb(db);

  const profRes = await readDb
    .from("profiles")
    .select("has_seen_tutorial")
    .eq("id", userId)
    .maybeSingle();

  if (!profRes.error && profRes.data?.has_seen_tutorial === true) {
    return { has_seen_tutorial: true };
  }

  if (profRes.error && !isMissingSchemaError(profRes.error)) {
    console.warn("[Tutorial] read profiles warning:", profRes.error.message);
  }

  const { data: settings } = await readDb
    .from("user_scrape_settings")
    .select("progress")
    .eq("user_id", userId)
    .maybeSingle();

  const env = parseEnvelope(settings?.progress);
  return { has_seen_tutorial: env["has_seen_tutorial"] === true };
}

export async function markTutorialSeenInDb(
  db: DB,
  userId: string,
  emailHint?: string | null,
): Promise<{ has_seen_tutorial: boolean }> {
  const writeDb = await getAdminOrUserDb(db);

  const { data: updated, error: updateErr } = await writeDb
    .from("profiles")
    .update({ has_seen_tutorial: true })
    .eq("id", userId)
    .select("id");

  if (!updateErr && (!updated || updated.length === 0)) {
    const email = (emailHint ?? "").trim() || `${userId}@users.local`;
    const { error: upsertErr } = await writeDb
      .from("profiles")
      .upsert({ id: userId, email, has_seen_tutorial: true }, { onConflict: "id" });
    if (upsertErr && !isMissingSchemaError(upsertErr)) {
      console.warn("[Tutorial] profiles upsert warning:", upsertErr.message);
    }
  } else if (updateErr && !isMissingSchemaError(updateErr)) {
    console.warn("[Tutorial] profiles update warning:", updateErr.message);
  }

  const { data: settings } = await writeDb
    .from("user_scrape_settings")
    .select("progress")
    .eq("user_id", userId)
    .maybeSingle();

  const existing = parseEnvelope(settings?.progress);
  const nextProgress = {
    ...existing,
    has_seen_tutorial: true,
  };

  const { error: settingsErr } = await writeDb.from("user_scrape_settings").upsert(
    {
      user_id: userId,
      progress: nextProgress as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (settingsErr) {
    console.warn("[Tutorial] progress fallback write warning:", settingsErr.message);
  }

  return { has_seen_tutorial: true };
}

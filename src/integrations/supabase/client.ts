// src/integrations/supabase/client.ts
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { brokeredPreviewStorage } from "./previewAuthStorage";

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseUrl: string, supabaseKey: string): typeof fetch {
  const publicUrl = supabaseUrl.replace(/\/+$/, "");
  
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );

    if (init?.headers) {
      new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    }

    // New Supabase API keys are opaque strings, not bearer JWTs.
    if (
      isNewSupabaseApiKey(supabaseKey) &&
      headers.get("Authorization") === `Bearer ${supabaseKey}`
    ) {
      headers.delete("Authorization");
    }

    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

function createSupabaseClient() {
  // 🚨 HARDCODED KEYS TO BYPASS RENDER ENVIRONMENT VARIABLE ISSUES 🚨
  const SUPABASE_URL = "https://oshovzzmolfanasirbyr.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_G8Do2xtWo60pfJJ_nVe5nw_V4s01E01";

  console.log("[Supabase] Initializing client with hardcoded keys", {
    url: SUPABASE_URL,
    keyPrefix: SUPABASE_ANON_KEY.slice(0, 10),
  });

  return createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_URL, SUPABASE_ANON_KEY),
    },
    auth: {
      storage: brokeredPreviewStorage(),
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
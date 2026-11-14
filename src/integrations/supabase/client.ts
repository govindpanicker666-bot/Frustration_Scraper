import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { brokeredPreviewStorage } from "./previewAuthStorage";

// 🚨 HARDCODED LEGACY KEYS TO BYPASS RENDER & SDK VERSION ISSUES 🚨
const SUPABASE_URL = "https://oshovzzmolfanasirbyr.supabase.co";

// PASTE YOUR eyJ... LEGACY ANON KEY HERE:
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zaG92enptb2xmYW5hc2lyYnlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ1MDQyMjMsImV4cCI6MjExMDA4MDIyM30.LRgXP9-IcJ43aUCUDm5JHyQ52jGXYwZsVfrAa_vO9xg";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
  },
});
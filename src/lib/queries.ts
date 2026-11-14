import type { Database } from "@/integrations/supabase/types";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { deduplicateLeads } from "./pipeline";

function isSchemaDriftError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return (
    err.code === "42703" ||
    err.code === "42P01" ||
    err.code === "PGRST204" ||
    err.code === "PGRST205" ||
    /does not exist|schema cache/i.test(err.message ?? "")
  );
}

export const leadsQuery = queryOptions({
  queryKey: ["leads"],
  staleTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
  queryFn: async () => {
    let { data, error } = await supabase
      .from("leads")
      .select("*")
      .gte("sentiment_score", 1)
      .order("date_scraped", { ascending: false })
      .limit(1000);
    if (error && error.code === "42703") {
      console.warn("[leadsQuery] Falling back to unordered leads select:", error.message);
      const fallback = await supabase.from("leads").select("*").limit(1000);
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      if (isSchemaDriftError(error)) {
        console.warn("[leadsQuery] Schema incomplete:", error.message);
        return [] as Lead[];
      }
      throw error;
    }
    const deduped = deduplicateLeads(data ?? []) as Lead[];

    const needsFallback = deduped.some((l) => l.osint_checked === undefined);
    if (!needsFallback) return deduped;

    const { data: settings } = await supabase
      .from("user_scrape_settings")
      .select("progress")
      .maybeSingle();
    const prog =
      settings?.progress &&
      typeof settings.progress === "object" &&
      !Array.isArray(settings.progress)
        ? (settings.progress as {
            osint_cache?: Record<string, { osint_checked?: boolean; osint_contacts?: unknown }>;
          })
        : null;
    const cache = prog?.osint_cache;
    if (!cache) return deduped;

    return deduped.map((l) => {
      if (l.osint_checked !== undefined) return l;
      const entry = cache[l.id];
      if (!entry) return l;
      return {
        ...l,
        osint_checked: Boolean(entry.osint_checked),
        osint_contacts: entry.osint_contacts ?? {
          emails: [],
          social_profiles: {},
          other_contacts: [],
        },
      };
    });
  },
});
export const competitorsQuery = queryOptions({
  queryKey: ["competitors"],
  staleTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
  queryFn: async () => {
    const { data, error } = await supabase.from("competitors").select("*");
    if (error) {
      if (isSchemaDriftError(error)) {
        console.warn("[competitorsQuery] Schema incomplete:", error.message);
        return [] as Database["public"]["Tables"]["competitors"]["Row"][];
      }
      throw error;
    }
    return [...(data ?? [])].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  },
});
export type Lead = Database["public"]["Tables"]["leads"]["Row"] & {
  osint_contacts?: unknown;
  osint_checked?: boolean | null;
};
export const newsQuery = queryOptions({
  queryKey: ["competitor_news"],
  staleTime: 0,
  refetchOnMount: "always",
  queryFn: async () => {
    const { data, error } = await supabase.from("competitor_news").select("*").limit(200);
    if (error) {
      if (isSchemaDriftError(error)) {
        console.warn("[newsQuery] Schema incomplete:", error.message);
        return [] as Database["public"]["Tables"]["competitor_news"]["Row"][];
      }
      throw error;
    }
    return [...(data ?? [])].sort((a, b) => {
      const ta = a.published_date ? Date.parse(a.published_date) : 0;
      const tb = b.published_date ? Date.parse(b.published_date) : 0;
      return (Number.isNaN(tb) ? 0 : tb) - (Number.isNaN(ta) ? 0 : ta);
    });
  },
});

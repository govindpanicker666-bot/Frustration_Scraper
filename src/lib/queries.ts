import type { Database } from "@/integrations/supabase/types";
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { deduplicateLeads } from "./pipeline";

export const leadsQuery = queryOptions({
  queryKey: ["leads"],
  staleTime: 0,
  refetchOnMount: "always",
  refetchOnWindowFocus: true,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .gte("sentiment_score", 1)
      .order("date_scraped", { ascending: false })
      .limit(1000);
    if (error) throw error;
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
    const { data, error } = await supabase.from("competitors").select("*").order("name");
    if (error) throw error;
    return data;
  },
});
export type Lead = Database["public"]["Tables"]["leads"]["Row"] & {
  osint_contacts?: unknown;
  osint_checked?: boolean | null;
};
export const newsQuery = queryOptions({
  queryKey: ["competitor_news"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("competitor_news")
      .select("*")
      .order("published_date", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) throw error;
    return data;
  },
});

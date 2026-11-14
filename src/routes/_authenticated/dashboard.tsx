import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Flame, Users, Gauge, Sparkles } from "lucide-react";
import { AutoScrape } from "@/components/AutoScrape";
import { CompanyBrandCard } from "@/components/CompanyBrandCard";
import { leadsQuery, competitorsQuery } from "@/lib/queries";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { detectSpikes, formatStatValue, platformLabel, safeAverageScore } from "@/lib/pipeline";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Churnhound" },
      { name: "description", content: "Your frustration-led lead overview." },
      { property: "og:title", content: "Dashboard — Churnhound" },
      { property: "og:description", content: "Your frustration-led lead overview." },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.fetchQuery(leadsQuery).catch(() => []),
      context.queryClient.fetchQuery(competitorsQuery).catch(() => []),
    ]),
  component: Dashboard,
});

function Dashboard() {
  const leadsQ = useQuery(leadsQuery);
  const compsQ = useQuery(competitorsQuery);
  const allLeads = Array.isArray(leadsQ.data) ? leadsQ.data : [];
  const comps = Array.isArray(compsQ.data) ? compsQ.data : [];
  // Figures follow the competitors currently tracked; the Leads page keeps every saved lead.
  const ids = new Set(comps.map((c) => c.id));
  const leads = allLeads.filter((l) => l.competitor_id && ids.has(l.competitor_id));
  const todayCutoff = Date.now() - 24 * 3600_000;
  const fresh = leads.filter((l) => {
    const ts = new Date(l.date_scraped).getTime();
    return Number.isFinite(ts) && ts > todayCutoff;
  }).length;
  const leadsUnavailable = leadsQ.isError && !leadsQ.data;
  const compsUnavailable = compsQ.isError && !compsQ.data;
  const statsLoading = (leadsQ.isPending && !leadsQ.data) || (compsQ.isPending && !compsQ.data);
  const stats = [
    {
      label: "Total leads",
      value: leadsUnavailable || compsUnavailable ? "-" : formatStatValue(leads.length),
      icon: Users,
    },
    {
      label: "New today",
      value: leadsUnavailable || compsUnavailable ? "-" : formatStatValue(fresh),
      icon: Sparkles,
    },
    {
      label: "Avg frustration",
      value:
        leadsUnavailable || compsUnavailable
          ? "-"
          : safeAverageScore(leads.map((l) => l.sentiment_score)),
      icon: Gauge,
    },
    {
      label: "Competitors tracked",
      value: compsUnavailable ? "-" : formatStatValue(comps.length),
      icon: Flame,
    },
  ];

  if (!compsQ.isPending && !compsQ.isError && comps.length === 0)
    return (
      <div className="space-y-6">
        <CompanyBrandCard />
        <div className="glass p-10 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Let's find your competitors</h1>
          <p className="mt-2 text-muted-foreground">
            Tell us your company and AI will suggest 40 or more competitors to watch.
          </p>
          <Button asChild variant="hero" className="mt-6">
            <Link to="/onboarding">Get started</Link>
          </Button>
        </div>
      </div>
    );

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      {detectSpikes(leads).map((sp) => (
        <div
          key={sp.competitor + sp.complaint}
          role="alert"
          className="rounded-xl border-2 border-destructive bg-destructive/15 p-5 shadow-[0_0_40px_-10px_var(--destructive)]"
        >
          <div className="text-xl font-bold text-destructive">
            🚨 Frustration Spike Detected for {sp.competitor}! Strike while the iron is hot.
          </div>
          <p className="mt-1 text-sm">
            {formatStatValue(sp.today)} leads today about "{sp.complaint}" (usually{" "}
            {formatStatValue(sp.baseline)}/day).{" "}
            <Link to="/leads" className="font-bold text-destructive underline">
              See the leads
            </Link>
          </p>
        </div>
      ))}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="glass p-5"
          >
            <s.icon className="h-5 w-5 text-primary" />
            {statsLoading ? (
              <Skeleton className="mt-3 h-9 w-16" />
            ) : (
              <div className="mt-3 text-3xl font-bold">{s.value}</div>
            )}
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </motion.div>
        ))}
      </div>
      <CompanyBrandCard />
      <AutoScrape />
      <div className="glass p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Hottest recent leads</h2>
          <Link to="/leads" className="text-sm text-primary">
            View all
          </Link>
        </div>
        {statsLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : leads.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {leadsUnavailable
              ? "Stats are temporarily unavailable. Refresh in a moment to see new leads."
              : "No leads yet. Turn on the daily scan above and new leads will appear here."}
          </p>
        ) : (
          <ul className="divide-y">
            {[...leads]
              .sort((a, b) => (Number(b.sentiment_score) || 0) - (Number(a.sentiment_score) || 0))
              .slice(0, 6)
              .map((l) => (
                <li key={l.id} className="flex items-center gap-4 py-3">
                  <ScoreBadge score={l.sentiment_score} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{l.extracted_complaint}</div>
                    <div className="truncate text-sm text-muted-foreground">
                      {l.reviewer_name} · {l.competitor_name} · {platformLabel(l.source_platform)}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

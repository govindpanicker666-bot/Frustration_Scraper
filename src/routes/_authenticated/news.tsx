import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  ExternalLink,
  Lightbulb,
  Megaphone,
  Newspaper,
  RefreshCw,
  Rocket,
  Sparkles,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { newsQuery } from "@/lib/queries";
import { refreshCompetitorNews } from "@/lib/insights.functions";

export const Route = createFileRoute("/_authenticated/news")({
  head: () => ({
    meta: [
      { title: "Competitor News — Churnhound" },
      { name: "description", content: "Latest competitor updates with tactical sales advice." },
      { property: "og:title", content: "Competitor News — Churnhound" },
      {
        property: "og:description",
        content: "Latest competitor updates with tactical sales advice.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(newsQuery),
  component: News,
});

const ICONS = {
  funding: Rocket,
  pr: Megaphone,
  pricing: Tag,
  product: Sparkles,
  other: Newspaper,
} as const;
const LABELS = {
  funding: "Funding",
  pr: "PR",
  pricing: "Pricing",
  product: "Product",
  other: "Update",
} as const;

function News() {
  const { data: news } = useSuspenseQuery(newsQuery);
  const refresh = useServerFn(refreshCompetitorNews);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [noFeed, setNoFeed] = useState<string[] | null>(null);

  async function run() {
    setBusy(true);
    try {
      const { results, saved, reason } = await refresh();
      setNoFeed(results.filter((r) => r.status === "no_feed").map((r) => r.name));
      if (saved > 0) {
        toast.success(`${saved} key insights picked`);
      } else if (reason === "no_competitors") {
        toast.info("Add at least one competitor first to track competitor news.");
      } else {
        toast.info("No recent news or blog announcements found for your competitors.");
      }
      await qc.invalidateQueries({ queryKey: newsQuery.queryKey });
      await qc.refetchQueries({ queryKey: newsQuery.queryKey });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Competitor News</h1>
          <p className="text-sm text-muted-foreground">
            The 5-7 competitor moves that matter, and how to use them.
          </p>
        </div>
        <Button onClick={run} disabled={busy}>
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "Checking feeds…" : "Refresh news"}
        </Button>
      </div>
      {noFeed && noFeed.length > 0 && (
        <p className="glass p-3 text-sm text-muted-foreground">
          No feed found for: {noFeed.join(", ")}
        </p>
      )}
      {news.length === 0 ? (
        <p className="glass p-6 text-sm text-muted-foreground">
          No news yet. Click "Refresh news".
        </p>
      ) : (
        <div className="space-y-4">
          {news.map((n) => {
            const t = (n.news_type in ICONS ? n.news_type : "other") as keyof typeof ICONS;
            const Icon = ICONS[t];
            return (
              <article key={n.id} className="glass p-5">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span className="font-bold text-foreground">{n.competitor_name}</span>
                      <span>{LABELS[t]}</span>
                      {n.published_date && (
                        <span>{new Date(n.published_date).toLocaleDateString()}</span>
                      )}
                    </div>
                    <h2 className="font-bold">{n.summary ?? n.title}</h2>
                    {n.why_it_matters && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-bold text-foreground">Why it matters: </span>
                        {n.why_it_matters}
                      </p>
                    )}
                    {n.tactical_advice && (
                      <div className="mt-3 flex gap-2 rounded-lg border border-primary/40 bg-primary/10 p-3 text-sm">
                        <Lightbulb className="h-4 w-4 shrink-0 text-primary" />
                        <span>
                          <span className="font-bold text-primary">Sales move: </span>
                          {n.tactical_advice}
                        </span>
                      </div>
                    )}
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                    >
                      Source: {n.title}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

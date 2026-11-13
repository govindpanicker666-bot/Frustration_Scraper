import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, FileText, Lightbulb, RefreshCw, Share2, Target } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  generateContentIdeas,
  getRecommendations,
  type ContentIdeaBlogTitle,
  type ContentIdeaSocialHook,
} from "@/lib/insights.functions";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import { leadsQuery, competitorsQuery } from "@/lib/queries";
import { platformLabel } from "@/lib/pipeline";

export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({
    meta: [
      { title: "Insights — Churnhound" },
      { name: "description", content: "Top complaints and leads by platform." },
      { property: "og:title", content: "Insights — Churnhound" },
      { property: "og:description", content: "Top complaints and leads by platform." },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.fetchQuery(leadsQuery),
      context.queryClient.fetchQuery(competitorsQuery),
    ]),
  component: Insights,
});

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function Insights() {
  const { data: allLeads } = useSuspenseQuery(leadsQuery);
  const { data: comps } = useSuspenseQuery(competitorsQuery);
  // Insights follow the competitors currently tracked; the Leads page keeps every saved lead.
  const ids = new Set(comps.map((c) => c.id));
  const leads = allLeads.filter((l) => l.competitor_id && ids.has(l.competitor_id));
  const since = Date.now() - 24 * 3600_000;
  const todays = leads.filter((l) => new Date(l.date_scraped).getTime() > since);
  const pool = todays.length ? todays : leads;
  const counts = new Map<string, number>();
  pool.forEach((l) => {
    const k = (l.extracted_complaint ?? "Other").trim();
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const byPlatform = Object.entries(
    leads.reduce<Record<string, number>>(
      (m, l) => ((m[l.source_platform] = (m[l.source_platform] ?? 0) + 1), m),
      {},
    ),
  ).map(([p, n]) => ({ name: platformLabel(p), leads: n }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="glass p-6">
          <h2 className="mb-1 text-lg font-bold">
            Top 5 complaints {todays.length ? "today" : "(all time)"}
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">{pool.length} leads analysed</p>
          {top.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <ol className="space-y-3">
              {top.map(([c, n], i) => (
                <li key={c} className="flex items-center gap-3">
                  <span className="w-6 text-lg font-semibold text-primary">{i + 1}</span>
                  <span className="flex-1 font-bold">{c}</span>
                  <span className="text-sm text-muted-foreground">
                    {n} mention{n > 1 ? "s" : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {top.length > 0 && <ContentIdeas complaints={top.map(([c]) => c)} />}
        </div>
        <div className="glass p-6">
          <h2 className="mb-4 text-lg font-bold">Leads by platform</h2>
          {byPlatform.length === 0 ? (
            <p className="text-sm text-muted-foreground">No data yet.</p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={byPlatform}>
                  <XAxis dataKey="name" stroke="var(--muted-foreground)" fontSize={12} />
                  <YAxis allowDecimals={false} stroke="var(--muted-foreground)" fontSize={12} />
                  <Tooltip
                    cursor={{ fill: "var(--secondary)" }}
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="leads" radius={[6, 6, 0, 0]}>
                    {byPlatform.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
      <Recommendations hasLeads={leads.length > 0} leadCount={leads.length} />
    </div>
  );
}

function Recommendations({ hasLeads, leadCount }: { hasLeads: boolean; leadCount: number }) {
  const gen = useServerFn(getRecommendations);
  // Server returns the saved version unless new leads arrived since it was generated.
  const q = useQuery({
    queryKey: ["recommendations", leadCount],
    queryFn: () => gen({ data: { force: false } }),
    enabled: hasLeads,
    staleTime: Infinity,
  });
  const [forcing, setForcing] = useState(false);
  const qc = useQueryClient();
  async function regenerate() {
    setForcing(true);
    try {
      const r = await gen({ data: { force: true } });
      qc.setQueryData(["recommendations", leadCount], r);
      if (r.error) toast.error(r.error);
    } finally {
      setForcing(false);
    }
  }
  const busy = q.isLoading || forcing;
  return (
    <section className="glass p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Target className="h-5 w-5 text-primary" />
            Strategic recommendations
          </h2>
          <p className="text-sm text-muted-foreground">
            {q.data?.generated_at
              ? `Updated ${new Date(q.data.generated_at).toLocaleString()} · refreshes when new leads arrive`
              : "Based on the most common complaints"}
          </p>
        </div>
        {hasLeads && (
          <Button variant="outline" size="sm" disabled={busy} onClick={regenerate}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
        )}
      </div>
      {!hasLeads ? (
        <p className="text-sm text-muted-foreground">
          No complaints yet. Run a scrape to get recommendations.
        </p>
      ) : busy ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : q.data?.error && !q.data.recommendations.length ? (
        <p className="text-sm text-destructive">{q.data.error}</p>
      ) : (
        <ol className="space-y-3">
          {q.data?.recommendations.map((r, i) => (
            <li key={i} className="flex gap-3 rounded-md border bg-secondary/40 p-3 text-sm">
              <span className="font-semibold text-primary">{i + 1}</span>
              <span>{r}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ContentIdeas({ complaints }: { complaints: string[] }) {
  const gen = useServerFn(generateContentIdeas);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blogTitles, setBlogTitles] = useState<ContentIdeaBlogTitle[]>([]);
  const [socialHooks, setSocialHooks] = useState<ContentIdeaSocialHook[]>([]);
  const [complaintsUsed, setComplaintsUsed] = useState<string[]>(complaints);

  async function run() {
    setModalOpen(true);
    setBusy(true);
    try {
      const r = await gen({ data: { complaints } });
      if (r.error) {
        toast.error(r.error);
      } else {
        setBlogTitles(r.blog_titles);
        setSocialHooks(r.social_hooks);
        if (r.complaints_used.length > 0) {
          setComplaintsUsed(r.complaints_used);
        }
      }
    } catch {
      toast.error("Could not generate ideas");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t pt-4">
      <Button size="sm" variant="outline" onClick={run} disabled={busy}>
        <Lightbulb className={busy ? "animate-pulse" : ""} />
        {busy ? "Generating…" : "Generate Content Ideas"}
      </Button>
      <p className="mt-1 text-xs text-muted-foreground">
        Combines the Top {Math.min(5, complaints.length)} complaints across all competitors
      </p>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-3 pr-6">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-primary" />
                  Content Ideas Generator
                </DialogTitle>
                <DialogDescription className="mt-1">
                  Mixed from Top {complaintsUsed.length || Math.min(5, complaints.length)}{" "}
                  competitor complaints: {complaintsUsed.slice(0, 5).join(" · ")}
                </DialogDescription>
              </div>
              <Button size="sm" variant="outline" onClick={run} disabled={busy}>
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                Regenerate
              </Button>
            </div>
          </DialogHeader>

          {busy ? (
            <div className="space-y-4 py-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-6 pt-2">
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <FileText className="h-4 w-4 text-primary" />
                  Blog Titles
                </h3>
                {blogTitles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No blog titles generated yet.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {blogTitles.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-start justify-between gap-3 rounded-lg border bg-secondary/40 p-3 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold">{item.title}</div>
                          {item.angle && (
                            <p className="mt-1 text-xs text-muted-foreground">{item.angle}</p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          aria-label={`Copy blog title ${idx + 1}`}
                          onClick={() => {
                            navigator.clipboard.writeText(item.title);
                            toast.success("Blog title copied");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-3 border-t pt-4">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Share2 className="h-4 w-4 text-primary" />
                  Social Media Hooks
                </h3>
                {socialHooks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No social hooks generated yet.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {socialHooks.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-start justify-between gap-3 rounded-lg border bg-secondary/40 p-3 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs text-muted-foreground">
                            {item.platform || "LinkedIn / X"}
                          </div>
                          <div className="mt-0.5 font-medium">{item.hook}</div>
                          {item.angle && (
                            <p className="mt-1 text-xs text-muted-foreground">{item.angle}</p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0"
                          aria-label={`Copy social hook ${idx + 1}`}
                          onClick={() => {
                            navigator.clipboard.writeText(item.hook);
                            toast.success("Social hook copied");
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

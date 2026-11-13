import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertCircle,
  ExternalLink,
  Megaphone,
  RefreshCw,
  Target,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getBrandHealthRecommendations,
  getBrandListeningData,
  scanOwnBrandMentions,
} from "@/lib/brand-listening.functions";
import {
  formatStatValue,
  platformLabel,
  summarizeBrandMentions,
  type BrandMention,
} from "@/lib/pipeline";

export const Route = createFileRoute("/_authenticated/brand-listening")({
  head: () => ({
    meta: [
      { title: "Brand Listening — Churnhound" },
      {
        name: "description",
        content: "Monitor positive, neutral, and negative public mentions of your own brand.",
      },
      { property: "og:title", content: "Brand Listening — Churnhound" },
      {
        property: "og:description",
        content: "Monitor positive, neutral, and negative public mentions of your own brand.",
      },
    ],
  }),
  component: BrandListeningPage,
});

const PLATFORM_BAR_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function BrandListeningPage() {
  const fetchBrandData = useServerFn(getBrandListeningData);
  const scanBrand = useServerFn(scanOwnBrandMentions);
  const qc = useQueryClient();
  const [startingScan, setStartingScan] = useState(false);
  const autoTriggeredRef = useRef(false);
  const prevRunningRef = useRef(false);

  const brandQuery = useQuery({
    queryKey: ["brand_listening"],
    queryFn: () => fetchBrandData(),
    staleTime: 10_000,
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d) return false;
      if (d.baseline_running) return 3000;
      if (
        !d.has_completed_brand_baseline &&
        (d.company_name || d.company_url) &&
        !d.baseline_error
      ) {
        return 3000;
      }
      return false;
    },
  });

  const state = brandQuery.data;
  const mentions = useMemo(() => state?.mentions ?? [], [state?.mentions]);
  const summary = useMemo(() => summarizeBrandMentions(mentions), [mentions]);
  const hasBrandProfile = Boolean(state?.company_name || state?.company_url);
  const isBaselinePending = Boolean(state && state.has_completed_brand_baseline === false);
  const isScanActive = Boolean(startingScan || state?.baseline_running);

  async function triggerBrandScan(silent = false) {
    setStartingScan(true);
    try {
      const res = await scanBrand();
      if (res.skipped) {
        if (!silent) toast.info("Add your company name or website in Competitors first.");
        return;
      }
      qc.setQueryData(["brand_listening"], res.state);
      if (!silent) {
        toast.success(
          res.alreadyRunning
            ? "Brand scan is already running in the background."
            : "Started brand scan in the background.",
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start brand scan");
    } finally {
      setStartingScan(false);
    }
  }

  useEffect(() => {
    if (!state) return;
    if (
      state.has_completed_brand_baseline === false &&
      hasBrandProfile &&
      !state.baseline_running &&
      !state.baseline_error &&
      !autoTriggeredRef.current
    ) {
      autoTriggeredRef.current = true;
      void triggerBrandScan(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state?.has_completed_brand_baseline,
    state?.baseline_running,
    state?.baseline_error,
    hasBrandProfile,
  ]);

  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    const isNowRunning = Boolean(state?.baseline_running);
    prevRunningRef.current = isNowRunning;

    if (wasRunning && !isNowRunning && state && !state.baseline_error) {
      void qc.invalidateQueries({ queryKey: ["brand_recommendations"] });
    }
  }, [state?.baseline_running, state?.baseline_error, state, qc]);

  const formattedAvgScore =
    summary.avgScore === null
      ? "-"
      : summary.avgScore > 0
        ? `+${summary.avgScore.toFixed(1)}`
        : summary.avgScore.toFixed(1);

  const baselinePct = state?.baseline_progress?.total_platforms
    ? Math.max(
        6,
        Math.min(
          98,
          Math.round(
            (state.baseline_progress.completed_platforms /
              state.baseline_progress.total_platforms) *
              100,
          ),
        ),
      )
    : 10;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Megaphone className="h-6 w-6 text-primary" />
            Brand Listening
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasBrandProfile ? (
              <>
                Monitoring{" "}
                <span className="font-medium text-foreground">
                  {state?.company_name || state?.company_url}
                </span>
                {state?.company_url && state?.company_name ? ` · ${state.company_url}` : ""}
                {state?.last_scraped_at
                  ? ` · Last scanned ${new Date(state.last_scraped_at).toLocaleString()}`
                  : ""}
              </>
            ) : (
              <>
                Set your company name and website under{" "}
                <Link to="/onboarding" className="font-medium text-primary underline">
                  Competitors
                </Link>{" "}
                to start monitoring your brand.
              </>
            )}
          </p>
        </div>
        {!isBaselinePending && (
          <Button
            size="sm"
            onClick={() => triggerBrandScan(false)}
            disabled={isScanActive || brandQuery.isLoading || !hasBrandProfile}
            className="shrink-0 whitespace-nowrap"
          >
            <RefreshCw className={`h-4 w-4 ${isScanActive ? "animate-spin" : ""}`} />
            {isScanActive ? "Scanning…" : "Scan Brand Now"}
          </Button>
        )}
      </div>

      {brandQuery.isLoading ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      ) : isBaselinePending ? (
        <section className="glass p-8">
          {!hasBrandProfile ? (
            <div className="mx-auto max-w-xl space-y-4 text-center">
              <h2 className="text-lg font-semibold">Set up your brand first</h2>
              <p className="text-sm text-muted-foreground">
                Add your company name and website in Competitors so Churnhound can build your
                historical brand listening baseline.
              </p>
              <Button asChild size="sm">
                <Link to="/onboarding">Configure Brand Profile</Link>
              </Button>
            </div>
          ) : state?.baseline_error && !state.baseline_running ? (
            <div className="mx-auto max-w-xl space-y-4 text-center">
              <div className="inline-flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertCircle className="h-4 w-4" />
                Baseline scan interrupted
              </div>
              <p className="text-sm text-muted-foreground">{state.baseline_error}</p>
              <Button size="sm" onClick={() => triggerBrandScan(false)} disabled={startingScan}>
                <RefreshCw className={`h-4 w-4 ${startingScan ? "animate-spin" : ""}`} />
                Retry Baseline Scan
              </Button>
            </div>
          ) : (
            <div className="mx-auto max-w-xl space-y-5">
              <div className="flex items-start gap-3">
                <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Historical Brand Baseline</h2>
                  <p className="text-sm text-muted-foreground">
                    Building your brand&apos;s historical baseline. This is a one-time process and
                    may take a few minutes.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Progress value={baselinePct} className="h-2.5" />
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-muted-foreground tabular-nums">
                  <span>
                    Platforms scanned: {state?.baseline_progress?.completed_platforms ?? 0} /{" "}
                    {state?.baseline_progress?.total_platforms ?? 29}
                  </span>
                  <span>Posts discovered: {state?.baseline_progress?.mentions_found ?? 0}</span>
                </div>
              </div>
            </div>
          )}
        </section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="glass p-5">
              <div className="text-xs text-muted-foreground">Total Mentions</div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                {formatStatValue(summary.total)}
              </div>
            </div>
            <div className="glass p-5">
              <div className="text-xs text-muted-foreground">Positive Share</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-emerald-600 tabular-nums dark:text-emerald-400">
                {summary.positiveShare === null ? "-" : `${summary.positiveShare}%`}
              </div>
            </div>
            <div className="glass p-5">
              <div className="text-xs text-muted-foreground">Avg Sentiment (-10 to +10)</div>
              <div className="mt-2 font-mono text-2xl font-semibold tabular-nums">
                {formattedAvgScore}
              </div>
            </div>
            <div className="glass p-5">
              <div className="text-xs text-muted-foreground">Negative Alerts</div>
              <div className="mt-2 font-mono text-2xl font-semibold text-red-600 tabular-nums dark:text-red-400">
                {formatStatValue(summary.negative)}
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="glass p-6">
              <h2 className="mb-1 text-lg font-bold">Sentiment Breakdown</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Positive, neutral, and negative mentions scored from -10 to +10
              </p>
              {summary.total === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No brand mentions captured yet. Click &ldquo;Scan Brand Now&rdquo; or wait for the
                  daily job.
                </p>
              ) : (
                <div className="grid items-center gap-4 sm:grid-cols-[1fr_180px]">
                  <div className="h-60">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={summary.sentimentBreakdown.filter((s) => s.value > 0)}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={84}
                          paddingAngle={2}
                        >
                          {summary.sentimentBreakdown
                            .filter((s) => s.value > 0)
                            .map((entry) => (
                              <Cell key={entry.key} fill={entry.color} />
                            ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "var(--popover)",
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-3 text-sm">
                    {summary.sentimentBreakdown.map((item) => {
                      const pct =
                        summary.total > 0 ? Math.round((item.value / summary.total) * 100) : 0;
                      return (
                        <div key={item.key} className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{ backgroundColor: item.color }}
                            />
                            <span>{item.name}</span>
                          </div>
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {item.value} ({pct}%)
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="glass p-6">
              <h2 className="mb-1 text-lg font-bold">Mention Volume by Platform</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Where customers are talking about your brand
              </p>
              {summary.byPlatform.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No platform volume data yet.
                </p>
              ) : (
                <div className="h-60">
                  <ResponsiveContainer>
                    <BarChart data={summary.byPlatform}>
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
                      <Bar dataKey="mentions" radius={[6, 6, 0, 0]}>
                        {summary.byPlatform.map((_, i) => (
                          <Cell
                            key={i}
                            fill={PLATFORM_BAR_COLORS[i % PLATFORM_BAR_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <FeedbackListCard
              title="Top Positive Feedback"
              tone="positive"
              items={summary.topPositive.slice(0, 8)}
              emptyText="No positive mentions (+2 to +10) captured yet."
            />
            <FeedbackListCard
              title="Top Negative Feedback"
              tone="negative"
              items={summary.topNegative.slice(0, 8)}
              emptyText="No negative mentions (-10 to -2) captured yet."
            />
          </div>

          <BrandHealthRecommendations
            hasMentions={mentions.length > 0}
            mentionCount={mentions.length}
          />
        </>
      )}
    </div>
  );
}

function FeedbackListCard({
  title,
  tone,
  items,
  emptyText,
}: {
  title: string;
  tone: "positive" | "negative";
  items: BrandMention[];
  emptyText: string;
}) {
  const isPositive = tone === "positive";
  return (
    <section className={`glass p-6 ${isPositive ? "border-emerald-500/30" : "border-red-500/30"}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2
          className={`flex items-center gap-2 text-lg font-bold ${
            isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
          }`}
        >
          {isPositive ? <ThumbsUp className="h-5 w-5" /> : <ThumbsDown className="h-5 w-5" />}
          {title}
        </h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {items.length} shown
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="divide-y">
          {items.map((m) => (
            <li key={m.id} className="space-y-1.5 py-3.5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-foreground">
                    {m.author || "Community user"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{platformLabel(m.platform)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{new Date(m.published_at || m.scraped_at).toLocaleDateString()}</span>
                </div>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    isPositive
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {m.sentiment_score > 0 ? `+${m.sentiment_score}` : m.sentiment_score}/10
                </span>
              </div>
              <p className="text-sm font-medium">{m.summary}</p>
              <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{m.text}</p>
              <div>
                <a
                  href={m.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary underline"
                >
                  View original post
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BrandHealthRecommendations({
  hasMentions,
  mentionCount,
}: {
  hasMentions: boolean;
  mentionCount: number;
}) {
  const gen = useServerFn(getBrandHealthRecommendations);
  const q = useQuery({
    queryKey: ["brand_recommendations", mentionCount],
    queryFn: () => gen({ data: { force: false } }),
    enabled: hasMentions,
    staleTime: Infinity,
  });

  const [forcing, setForcing] = useState(false);
  const qc = useQueryClient();

  async function regenerate() {
    setForcing(true);
    try {
      const r = await gen({ data: { force: true } });
      qc.setQueryData(["brand_recommendations", mentionCount], r);
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
            Brand Health Recommendations
          </h2>
          <p className="text-sm text-muted-foreground">
            {q.data?.generated_at
              ? `Updated ${new Date(q.data.generated_at).toLocaleString()} · synthesized from positive and negative brand feedback`
              : "Actionable steps generated from your recent brand mentions"}
          </p>
        </div>
        {hasMentions && (
          <Button variant="outline" size="sm" disabled={busy} onClick={regenerate}>
            <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
        )}
      </div>

      {!hasMentions ? (
        <p className="text-sm text-muted-foreground">
          No brand mentions yet. Run a brand scan to generate Brand Health Recommendations.
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
          {(q.data?.recommendations ?? []).map((rec, i) => (
            <li key={i} className="flex gap-3 rounded-md border bg-secondary/40 p-3 text-sm">
              <span className="font-mono font-semibold text-primary tabular-nums">{i + 1}</span>
              <span>{rec}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

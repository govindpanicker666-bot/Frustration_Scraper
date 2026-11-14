import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  Eye,
  LoaderCircle,
  Radar,
  Search,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { getAIVisibilityScansFn, runAIVisibilityScanFn } from "@/lib/ai-visibility.functions";

type ScanRow = {
  id: string;
  user_id: string;
  brand_name: string;
  model_name: string;
  prompt_text: string;
  visibility_score: number;
  rank_position: number | null;
  sentiment: "positive" | "neutral" | "negative";
  citations: Array<{ title: string; url: string; domain: string }>;
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/ai-visibility")({
  head: () => ({
    meta: [
      { title: "AI Visibility — Churnhound" },
      { name: "description", content: "Track how AI assistants recommend and rank your brand." },
    ],
  }),
  component: AIVisibilityPage,
});

function ScoreGauge({ score }: { score: number }) {
  const circumference = 2 * Math.PI * 42;
  const offset = circumference - (score / 100) * circumference;
  const tone = score >= 70 ? "text-emerald-500" : score >= 35 ? "text-amber-500" : "text-rose-500";
  return (
    <div className="relative flex h-32 w-32 items-center justify-center">
      <svg viewBox="0 0 100 100" className="-rotate-90">
        <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="8" className="text-muted/60" />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={tone}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-3xl font-bold tabular-nums">{score}</div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">out of 100</div>
      </div>
    </div>
  );
}

function AIVisibilityPage() {
  const fetchScans = useServerFn(getAIVisibilityScansFn);
  const executeScan = useServerFn(runAIVisibilityScanFn);
  const queryClient = useQueryClient();
  const [brandName, setBrandName] = useState("");
  const [competitorNames, setCompetitorNames] = useState("");
  const [running, setRunning] = useState(false);

  const scanQuery = useQuery({
    queryKey: ["ai_visibility_scans"],
    queryFn: () => fetchScans(),
  });
  const scans = (scanQuery.data ?? []) as ScanRow[];
  const latest = scans[0];
  const latestRun = useMemo(() => {
    if (!latest) return [] as ScanRow[];
    const timestamp = new Date(latest.created_at).getTime();
    const key = latest.brand_name;
    return scans.filter(
      (row) =>
        row.brand_name === key &&
        row.created_at === latest.created_at,
    );
  }, [latest, scans]);

  const metrics = useMemo(() => {
    const rows = latestRun;
    const total = rows.length;
    const mentioned = rows.filter((row) => row.rank_position !== null).length;
    const averageScore = total
      ? Math.round(rows.reduce((sum, row) => sum + row.visibility_score, 0) / total)
      : 0;
    const mentionedRows = rows.filter((row) => row.rank_position !== null);
    const positive = mentionedRows.filter((row) => row.sentiment === "positive").length;
    const neutral = mentionedRows.filter((row) => row.sentiment === "neutral").length;
    const negative = mentionedRows.filter((row) => row.sentiment === "negative").length;
    const ranked = rows.filter((row) => row.rank_position !== null);
    const averageRank = ranked.length
      ? Number((ranked.reduce((sum, row) => sum + (row.rank_position ?? 0), 0) / ranked.length).toFixed(1))
      : null;
    return { total, mentioned, averageScore, positive, neutral, negative, averageRank };
  }, [latestRun]);

  const sentimentData = [
    { name: "Positive", value: metrics.positive, fill: "hsl(145 55% 42%)" },
    { name: "Neutral", value: metrics.neutral, fill: "hsl(215 15% 55%)" },
    { name: "Negative", value: metrics.negative, fill: "hsl(0 70% 55%)" },
  ].filter((item) => item.value > 0);

  const rankData = latestRun.map((row, index) => ({
    prompt: `Q${index + 1}`,
    score: row.visibility_score,
    rank: row.rank_position ?? 0,
  }));

  async function handleScan() {
    if (!brandName.trim()) {
      toast.error("Enter your brand name first.");
      return;
    }
    setRunning(true);
    try {
      const competitors = competitorNames
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean);
      const result = await executeScan({
        data: { brand_name: brandName.trim(), competitor_names: competitors },
      });
      toast.success(`Scan complete: ${result.promptsCompleted}/10 prompts analyzed.`);
      setBrandName(result.brandName);
      await queryClient.invalidateQueries({ queryKey: ["ai_visibility_scans"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not run visibility scan.");
    } finally {
      setRunning(false);
    }
  }

  const allCitations = latestRun.flatMap((row) =>
    (Array.isArray(row.citations) ? row.citations : []).map((citation) => ({
      ...citation,
      prompt: row.prompt_text,
      model: row.model_name,
    })),
  );
  const uniqueCitations = allCitations.filter(
    (citation, index, all) => all.findIndex((item) => item.url === citation.url) === index,
  );

  return (
    <div className="space-y-7">
      <div className="flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
            <Radar className="h-4 w-4" /> AI search intelligence
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">AI Visibility Tracker</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            See whether AI assistants mention your brand when buyers compare solutions.
          </p>
        </div>
        <Badge variant="outline" className="w-fit gap-1.5">
          <Activity className="h-3 w-3" /> Gemini · Google Search grounding
        </Badge>
      </div>

      <section className="glass grid gap-4 p-5 lg:grid-cols-[1.1fr_1fr_auto] lg:items-end">
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="visibility-brand">Your brand</label>
          <Input
            id="visibility-brand"
            placeholder="e.g. Acme"
            value={brandName}
            onChange={(event) => setBrandName(event.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="visibility-competitors">Competitors (comma separated)</label>
          <Input
            id="visibility-competitors"
            placeholder="e.g. Competitor A, Competitor B"
            value={competitorNames}
            onChange={(event) => setCompetitorNames(event.target.value)}
            maxLength={1000}
          />
        </div>
        <Button onClick={handleScan} disabled={running} className="min-w-32">
          {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? "Scanning…" : "Run Scan"}
        </Button>
      </section>

      {scanQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-36 rounded-xl" />)}
        </div>
      ) : latestRun.length === 0 ? (
        <section className="glass flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="rounded-2xl bg-primary/10 p-4 text-primary"><Eye className="h-7 w-7" /></div>
          <h2 className="text-lg font-semibold">No visibility data yet</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Run your first scan to test ten realistic buyer prompts against Gemini with Google Search grounding.
          </p>
        </section>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="glass flex items-center gap-4 p-5">
              <ScoreGauge score={metrics.averageScore} />
              <div><p className="text-sm text-muted-foreground">Visibility score</p><p className="mt-1 text-xs text-muted-foreground">Average across prompts</p></div>
            </div>
            <div className="glass p-5">
              <div className="flex items-center justify-between text-muted-foreground"><span className="text-sm">Mention rate</span><Target className="h-4 w-4" /></div>
              <div className="mt-3 font-display text-3xl font-bold tabular-nums">{metrics.total ? Math.round((metrics.mentioned / metrics.total) * 100) : 0}%</div>
              <p className="mt-1 text-xs text-muted-foreground">{metrics.mentioned} of {metrics.total} prompts mentioned your brand</p>
            </div>
            <div className="glass p-5">
              <div className="flex items-center justify-between text-muted-foreground"><span className="text-sm">Average position</span><Trophy className="h-4 w-4" /></div>
              <div className="mt-3 font-display text-3xl font-bold tabular-nums">{metrics.averageRank ?? "—"}</div>
              <p className="mt-1 text-xs text-muted-foreground">First distinct brand mention order</p>
            </div>
            <div className="glass p-5">
              <div className="flex items-center justify-between text-muted-foreground"><span className="text-sm">Prompts analyzed</span><Search className="h-4 w-4" /></div>
              <div className="mt-3 font-display text-3xl font-bold tabular-nums">{metrics.total}/10</div>
              <p className="mt-1 text-xs text-muted-foreground">Latest Gemini scan</p>
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="glass p-5">
              <h2 className="font-semibold">Sentiment breakdown</h2>
              <p className="mb-4 mt-1 text-xs text-muted-foreground">Tone around your brand when mentioned</p>
              {sentimentData.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={sentimentData} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={3}>
                        {sentimentData.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : <p className="py-16 text-center text-sm text-muted-foreground">No mentions to classify.</p>}
              <div className="flex justify-center gap-5 text-xs">
                <span className="text-emerald-500">Positive {metrics.positive}</span>
                <span className="text-muted-foreground">Neutral {metrics.neutral}</span>
                <span className="text-rose-500">Negative {metrics.negative}</span>
              </div>
            </div>
            <div className="glass p-5">
              <h2 className="font-semibold">Visibility by buyer prompt</h2>
              <p className="mb-4 mt-1 text-xs text-muted-foreground">Higher scores indicate an earlier brand mention</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rankData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="prompt" tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Bar dataKey="score" name="Visibility score" radius={[5, 5, 0, 0]} fill="var(--chart-1)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          <section className="glass overflow-hidden">
            <div className="border-b p-5">
              <h2 className="font-semibold">Buyer prompt results</h2>
              <p className="mt-1 text-xs text-muted-foreground">The exact query, mention order, and sentiment recorded for each prompt.</p>
            </div>
            <div className="divide-y">
              {latestRun.map((row, index) => (
                <div key={row.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Prompt {index + 1}</p>
                    <p className="mt-1 text-sm">{row.prompt_text}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={row.rank_position ? "default" : "outline"}>
                      {row.rank_position ? `Rank #${row.rank_position}` : "Not mentioned"}
                    </Badge>
                    <Badge variant="outline" className={
                      row.sentiment === "positive" ? "border-emerald-500/40 text-emerald-600" :
                      row.sentiment === "negative" ? "border-rose-500/40 text-rose-600" : ""
                    }>{row.sentiment}</Badge>
                  </div>
                  <div className="text-right font-mono text-lg font-semibold tabular-nums">{row.visibility_score}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass overflow-hidden">
            <div className="border-b p-5">
              <h2 className="font-semibold">Cited sources</h2>
              <p className="mt-1 text-xs text-muted-foreground">URLs returned in Gemini Search grounding metadata.</p>
            </div>
            {uniqueCitations.length ? (
              <div className="divide-y">
                {uniqueCitations.map((citation, index) => (
                  <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/40">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{citation.title || citation.domain}</p>
                      <p className="truncate text-xs text-muted-foreground">{citation.domain} · {citation.prompt}</p>
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </a>
                ))}
              </div>
            ) : <p className="p-8 text-center text-sm text-muted-foreground">No source citations were returned for this scan.</p>}
          </section>
        </>
      )}
    </div>
  );
}

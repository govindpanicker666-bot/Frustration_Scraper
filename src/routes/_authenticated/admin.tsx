import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileText,
  Loader2,
  Play,
  Trash2,
  UserSearch,
} from "lucide-react";
import { toast } from "sonner";
import { reenrichContacts } from "@/lib/leads.functions";
import { AutoScrape } from "@/components/AutoScrape";
import { competitorsQuery } from "@/lib/queries";
import { useCurrentUser } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { formatStatValue, PLATFORMS, platformLabel } from "@/lib/pipeline";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Admin — Churnhound" },
      { name: "description", content: "Trigger manual scrapes." },
      { property: "og:title", content: "Admin — Churnhound" },
      { property: "og:description", content: "Trigger manual scrapes." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(competitorsQuery),
  component: Admin,
});

type Step = "idle" | "fetching" | "analyzing" | "done";

interface ManualScrapeStats {
  found: number;
  relevant: number;
  analyzed: number;
  saved: number;
  emails: number;
  linkedin: number;
  social: number;
  discarded: number;
}

interface ManualScrapeSourceSummary {
  platform: string;
  status: string;
  count: number;
}

interface ManualScrapeJobStatus {
  job_id: string;
  job_status: "idle" | "running" | "completed";
  current_competitor_index: number;
  total_competitors: number;
  current_competitor_name: string | null;
  step: Step;
  stats: ManualScrapeStats;
  sources: ManualScrapeSourceSummary[];
  errors: string[];
  started_at: string | null;
  updated_at: string;
  finished_at: string | null;
}

const POLL_INTERVAL_MS = 2500;

async function getBearerToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function Admin() {
  const { data: me, isLoading } = useCurrentUser();
  const { data: comps } = useSuspenseQuery(competitorsQuery);
  const qc = useQueryClient();
  const [cid, setCid] = useState("");
  const [platform, setPlatform] = useState<string>("all");
  const [starting, setStarting] = useState(false);
  const [jobState, setJobState] = useState<ManualScrapeJobStatus | null>(null);
  const [dangerTarget, setDangerTarget] = useState<"leads" | "competitors" | null>(null);
  const [dangerBusy, setDangerBusy] = useState(false);
  const lastSavedRef = useRef(0);
  const prevJobStatusRef = useRef<"idle" | "running" | "completed" | null>(null);

  const applyJobStatus = useCallback(
    (next: ManualScrapeJobStatus | null) => {
      if (!next) return;
      setJobState(next);

      const prevStatus = prevJobStatusRef.current;
      prevJobStatusRef.current = next.job_status;

      const savedCount = Number.isFinite(next.stats?.saved) ? next.stats.saved : 0;
      if (savedCount > lastSavedRef.current) {
        lastSavedRef.current = savedCount;
        qc.invalidateQueries({ queryKey: ["leads"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
      }

      if (prevStatus === "running" && next.job_status === "completed") {
        qc.invalidateQueries({ queryKey: ["leads"] });
        qc.invalidateQueries({ queryKey: ["stats"] });
        if (next.errors.length > 0) {
          toast.warning(
            `Scrape completed with ${next.errors.length} competitor error(s). Saved ${savedCount} lead(s).`,
          );
        } else {
          toast.success(`Scrape completed. Saved ${savedCount} lead(s).`);
        }
      }
    },
    [qc],
  );

  const fetchStatus = useCallback(async () => {
    try {
      const token = await getBearerToken();
      if (!token) return;
      const res = await fetch("/api/admin/scrape-status", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const contentType = res.headers.get("content-type") ?? "";
      const rawText = await res.text();
      if (!res.ok || !contentType.includes("application/json")) {
        console.warn("[Admin] /api/admin/scrape-status non-JSON or error response:", {
          status: res.status,
          statusText: res.statusText,
          contentType,
          body: rawText.slice(0, 1000),
        });
        return;
      }
      const payload = JSON.parse(rawText) as { ok?: boolean; status?: ManualScrapeJobStatus };
      if (payload.ok && payload.status) {
        applyJobStatus(payload.status);
      }
    } catch (err) {
      console.warn("[Admin] /api/admin/scrape-status poll error:", err);
    }
  }, [applyJobStatus]);

  useEffect(() => {
    if (!me?.isAdmin) return;
    void fetchStatus();
  }, [me?.isAdmin, fetchStatus]);

  useEffect(() => {
    if (!me?.isAdmin || jobState?.job_status !== "running") return;
    const timer = setInterval(() => {
      void fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [me?.isAdmin, jobState?.job_status, fetchStatus]);

  if (isLoading) return null;
  if (!me?.isAdmin)
    return (
      <div className="glass p-10 text-center text-muted-foreground">
        This page is for admins only.
      </div>
    );

  async function trigger() {
    const targets = cid === "__all" ? comps : comps.filter((c) => c.id === cid);
    if (!targets.length) {
      toast.error("Pick a competitor");
      return;
    }

    setStarting(true);
    try {
      const token = await getBearerToken();
      console.log("[Admin] Triggering /api/admin/scrape-all", {
        competitorCount: targets.length,
        platform,
        hasBearerToken: Boolean(token),
      });
      if (!token) {
        toast.error("Session expired — please sign in again.");
        return;
      }

      const res = await fetch("/api/admin/scrape-all", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          competitor_ids: targets.map((c) => c.id),
          platform,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      const rawText = await res.text();
      console.log("[Admin] /api/admin/scrape-all raw response:", {
        status: res.status,
        statusText: res.statusText,
        contentType,
        body: rawText,
      });

      let payload: {
        ok?: boolean;
        started?: boolean;
        resumed?: boolean;
        status?: ManualScrapeJobStatus;
        error?: string;
      };
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error(
          `Unexpected server response (HTTP ${res.status} ${contentType || "unknown"}): check browser console for details`,
        );
      }

      if (!res.ok || !payload.ok || !payload.status) {
        throw new Error(payload.error || `Failed to start scrape job (HTTP ${res.status})`);
      }

      lastSavedRef.current = payload.status.stats?.saved ?? 0;
      prevJobStatusRef.current = payload.status.job_status;
      setJobState(payload.status);

      if (payload.resumed) {
        toast.info("Job Started — resumed existing background scrape job.");
      } else if (payload.started) {
        toast.success(
          "Job Started — running in the background. You can switch tabs or refresh anytime.",
        );
      } else {
        toast.info("A background scrape job is already running.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start scrape job");
    } finally {
      setStarting(false);
    }
  }

  const busy = starting || jobState?.job_status === "running";
  const step: Step = starting ? "fetching" : (jobState?.step ?? "idle");
  const progress =
    jobState?.job_status === "running" && jobState.total_competitors > 0
      ? `${jobState.current_competitor_name ?? "Competitor"} (${Math.min(
          jobState.current_competitor_index + 1,
          jobState.total_competitors,
        )}/${jobState.total_competitors})`
      : "";
  const showResults =
    jobState &&
    jobState.total_competitors > 0 &&
    (jobState.job_status === "running" || jobState.job_status === "completed");

  const steps: { key: Step; label: string }[] = [
    { key: "fetching", label: "Fetching posts from the last 48 hours" },
    { key: "analyzing", label: "Checking relevance, scoring, finding LinkedIn & email" },
    { key: "done", label: "Saving leads with a contact" },
  ];
  const order: Step[] = ["idle", "fetching", "analyzing", "done"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/blog-admin">
              <FileText />
              Blog
            </Link>
          </Button>
          <RefindAll />
        </div>
      </div>
      <AutoScrape />
      <h2 className="text-lg font-semibold">Manual scrape</h2>
      <div className="glass flex flex-col gap-3 p-5 md:flex-row">
        <Select value={cid} onValueChange={setCid}>
          <SelectTrigger className="md:w-64">
            <SelectValue placeholder="Choose competitor" />
          </SelectTrigger>
          <SelectContent>
            {comps.length > 1 && (
              <SelectItem value="__all">All competitors ({comps.length})</SelectItem>
            )}
            {comps.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="md:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {PLATFORMS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="default" onClick={trigger} disabled={busy || !cid}>
          {busy ? <Loader2 className="animate-spin" /> : <Play />}
          {busy ? "Running in Background…" : "Trigger Scrape"}
        </Button>
      </div>
      {step !== "idle" && (
        <div className="glass space-y-3 p-5">
          {progress && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-bold">Now scraping: {progress}</div>
              <div className="text-xs text-muted-foreground">
                Running on server — safe to switch tabs or refresh
              </div>
            </div>
          )}
          {steps.map((s) => {
            const idx = order.indexOf(s.key),
              cur = order.indexOf(step);
            const done = cur > idx || step === "done";
            return (
              <div key={s.key} className="flex items-center gap-3 text-sm">
                {done ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : cur === idx ? (
                  <Loader2 className="h-4 w-4 animate-spin text-indigo" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={done ? "" : "text-muted-foreground"}>{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
      {showResults && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            {(
              [
                ["Posts found", jobState.stats.found],
                ["About this competitor", jobState.stats.relevant],
                ["Leads saved", jobState.stats.saved],
                ["Discarded (no contact)", jobState.stats.discarded],
              ] as const
            ).map(([l, v]) => (
              <div key={l} className="glass p-5">
                <div className="text-3xl font-bold">{formatStatValue(v)}</div>
                <div className="text-sm text-muted-foreground">{l}</div>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Emails {formatStatValue(jobState.stats.emails)} · LinkedIn{" "}
            {formatStatValue(jobState.stats.linkedin)} · Social Signals{" "}
            {formatStatValue(jobState.stats.social)}
          </p>
          {jobState.sources.length > 0 && (
            <div className="glass flex flex-wrap gap-2 p-4">
              {jobState.sources.map((s) => (
                <span
                  key={s.platform}
                  className={
                    "rounded-full px-3 py-1 text-xs " +
                    (s.status === "ok"
                      ? "bg-primary/15 text-primary"
                      : "bg-secondary text-muted-foreground")
                  }
                >
                  {platformLabel(s.platform)}:{" "}
                  {s.status === "ok"
                    ? formatStatValue(s.count)
                    : s.status === "no_match"
                      ? "not found"
                      : s.status === "no_key"
                        ? "no key"
                        : "blocked"}
                </span>
              ))}
            </div>
          )}
          {jobState.errors.length > 0 && (
            <div className="glass space-y-1 p-4 text-xs text-amber-400">
              <div className="font-semibold">Competitor errors ({jobState.errors.length}):</div>
              {jobState.errors.map((err, i) => (
                <div key={i}>{err}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="glass space-y-4 border border-destructive/40 p-5">
        <div className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Danger Zone</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Permanently clear scraped leads or tracked competitors. These actions cannot be undone.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="destructive"
            onClick={() => setDangerTarget("leads")}
            disabled={dangerBusy}
          >
            <Trash2 />
            Delete All Leads
          </Button>
          <Button
            variant="destructive"
            onClick={() => setDangerTarget("competitors")}
            disabled={dangerBusy}
          >
            <Trash2 />
            Delete All Competitors
          </Button>
        </div>
      </div>

      <AlertDialog
        open={dangerTarget !== null}
        onOpenChange={(isOpen) => !isOpen && !dangerBusy && setDangerTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dangerTarget === "competitors"
                ? "Delete all competitors and their leads?"
                : "Delete all leads?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dangerTarget === "competitors"
                ? "This will permanently delete ALL competitors and cascade delete ALL associated leads from the database. You will need to re-add or re-detect competitors afterward."
                : "This will permanently delete ALL leads in the database. Tracked competitors will remain untouched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dangerBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={dangerBusy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!dangerTarget) return;
                setDangerBusy(true);
                try {
                  const token = await getBearerToken();
                  if (!token) {
                    toast.error("Session expired — please sign in again.");
                    return;
                  }
                  const endpoint =
                    dangerTarget === "competitors" ? "/api/competitors" : "/api/leads";
                  const res = await fetch(endpoint, {
                    method: "DELETE",
                    headers: {
                      Accept: "application/json",
                      Authorization: `Bearer ${token}`,
                    },
                  });
                  const payload = (await res.json()) as { ok?: boolean; error?: string };
                  if (!res.ok || !payload.ok) {
                    throw new Error(payload.error || "Deletion failed");
                  }
                  if (dangerTarget === "competitors") {
                    setCid("");
                    toast.success("All competitors and associated leads deleted");
                  } else {
                    toast.success("All leads deleted");
                  }
                  setDangerTarget(null);
                  await Promise.all([
                    qc.invalidateQueries({ queryKey: ["leads"] }),
                    qc.invalidateQueries({ queryKey: ["competitors"] }),
                    qc.invalidateQueries({ queryKey: ["stats"] }),
                    qc.invalidateQueries({ queryKey: ["competitor_news"] }),
                  ]);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Deletion failed");
                } finally {
                  setDangerBusy(false);
                }
              }}
            >
              {dangerBusy ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {dangerBusy
                ? "Deleting..."
                : dangerTarget === "competitors"
                  ? "Yes, Delete All Competitors"
                  : "Yes, Delete All Leads"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RefindAll() {
  const fn = useServerFn(reenrichContacts);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await fn({ data: { lead_ids: null } });
      toast.success(`Checked ${r.checked} leads, found contacts for ${r.found}`);
      qc.invalidateQueries({ queryKey: ["leads"] });
    } catch {
      toast.error("Contact search failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={run} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <UserSearch />}Re-find contacts (latest 10)
    </Button>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Loader2,
  Radar,
  ShieldCheck,
  Sparkles,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  computeFirstRunProgress,
  diffScrapeStatusLogs,
  formatStatValue,
  platformLabel,
  type FirstRunLogEntry,
  type ScrapeStatusSnapshot,
} from "@/lib/pipeline";
import { cn } from "@/lib/utils";

interface FirstRunScanProps {
  initialStatus: ScrapeStatusSnapshot;
  startError?: string | null;
  onViewDashboard: (scanStillRunning: boolean) => void;
}

const POLL_INTERVAL_MS = 2500;

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function FirstRunScan({
  initialStatus,
  startError = null,
  onViewDashboard,
}: FirstRunScanProps) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ScrapeStatusSnapshot>(initialStatus);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [logs, setLogs] = useState<FirstRunLogEntry[]>(() => {
    const seeded = diffScrapeStatusLogs(null, initialStatus, new Date(), 0);
    if (startError) {
      seeded.push({
        id: `start-err-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }),
        message: `Background trigger warning: ${startError}`,
        tone: "warn",
      });
    }
    return seeded;
  });

  const prevStatusRef = useRef<ScrapeStatusSnapshot>(initialStatus);
  const lastSavedRef = useRef<number>(initialStatus.stats.saved ?? 0);
  const seqRef = useRef<number>(10);
  const isPollingRef = useRef<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  const expectedJobId = initialStatus.job_id;

  const applyPollStatus = useCallback(
    (next: ScrapeStatusSnapshot) => {
      if (
        expectedJobId &&
        expectedJobId !== "pending" &&
        next.job_id &&
        next.job_id !== expectedJobId &&
        next.job_status === "idle"
      ) {
        return;
      }

      const prev = prevStatusRef.current;
      const newEntries = diffScrapeStatusLogs(prev, next, new Date(), seqRef.current);
      seqRef.current += newEntries.length + 1;

      if (newEntries.length > 0) {
        setLogs((curr) => [...curr.slice(-60), ...newEntries]);
      }

      prevStatusRef.current = next;
      setStatus(next);

      const savedCount = Number.isFinite(next.stats?.saved) ? next.stats.saved : 0;
      if (savedCount > lastSavedRef.current || next.job_status === "completed") {
        lastSavedRef.current = Math.max(lastSavedRef.current, savedCount);
        void qc.invalidateQueries({ queryKey: ["leads"] });
        void qc.invalidateQueries({ queryKey: ["stats"] });
      }
    },
    [expectedJobId, qc],
  );

  const pollStatus = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      const res = await fetch("/api/admin/scrape-status", {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok || !contentType.includes("application/json")) return;

      const payload = (await res.json()) as {
        ok?: boolean;
        status?: ScrapeStatusSnapshot;
      };
      if (payload.ok && payload.status) {
        applyPollStatus(payload.status);
      }
    } catch (err) {
      console.warn("[FirstRunScan] scrape-status poll warning:", err);
    } finally {
      isPollingRef.current = false;
    }
  }, [applyPollStatus]);

  useEffect(() => {
    if (status.job_status === "completed" || startError) return;
    const pollTimer = window.setInterval(() => {
      void pollStatus();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(pollTimer);
  }, [status.job_status, startError, pollStatus]);

  useEffect(() => {
    if (status.job_status === "completed" || startError) return;
    const clockTimer = window.setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => window.clearInterval(clockTimer);
  }, [status.job_status, startError]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const metrics = useMemo(
    () =>
      computeFirstRunProgress(
        status,
        initialStatus.total_competitors || 1,
        elapsedSeconds,
        Boolean(startError),
      ),
    [status, initialStatus.total_competitors, elapsedSeconds, startError],
  );

  const activeOrder: Array<ScrapeStatusSnapshot["step"]> = [
    "idle",
    "fetching",
    "analyzing",
    "done",
  ];
  const currentStepIdx = activeOrder.indexOf(
    metrics.isComplete ? "done" : status.step === "idle" ? "fetching" : status.step,
  );

  const stepItems: Array<{ key: ScrapeStatusSnapshot["step"]; label: string }> = [
    { key: "fetching", label: "Fetching recent posts across social & review sites" },
    { key: "analyzing", label: "Gemini scoring frustration signals & buyer intent" },
    { key: "done", label: "Saving qualified leads & contact details" },
  ];

  const milestones = [
    {
      label: "Competitors Saved",
      detail: `${metrics.totalCompetitors} queued`,
      done: true,
    },
    {
      label: "Initial Batch (3)",
      detail:
        metrics.processedCompetitors >= 3 || metrics.isComplete
          ? "Dashboard ready"
          : `${Math.min(metrics.processedCompetitors, 3)} / 3`,
      done: metrics.processedCompetitors >= 3 || metrics.isComplete,
    },
    {
      label: "Full Workspace Scan",
      detail: metrics.isComplete ? "Complete" : `${metrics.progressPercent}%`,
      done: metrics.isComplete,
    },
  ];

  const currentCompetitorDisplay = metrics.isComplete
    ? "All competitors scanned"
    : status.current_competitor_name
      ? status.current_competitor_name
      : "Preparing scanner";

  const activeIndexDisplay = metrics.isComplete
    ? metrics.totalCompetitors
    : Math.min(metrics.processedCompetitors + 1, metrics.totalCompetitors);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mx-auto max-w-4xl space-y-6"
    >
      <div className="glass space-y-6 p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
              <span>First Run Live Scan</span>
              <span aria-hidden="true">·</span>
              <span>
                Competitor {activeIndexDisplay} of {metrics.totalCompetitors}
              </span>
              <span aria-hidden="true">·</span>
              <span>Elapsed {formatDuration(elapsedSeconds)}</span>
            </div>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-balance md:text-3xl">
              {metrics.isComplete
                ? "Your first lead scan is complete"
                : metrics.earlyUnlockReady
                  ? "Initial leads ready — finishing remaining competitors"
                  : "Hunting for frustrated buyers right now"}
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              {metrics.isComplete
                ? `Scanned ${formatStatValue(metrics.totalPostsFound)} posts across your competitors and saved ${formatStatValue(metrics.leadsSaved)} qualified lead${metrics.leadsSaved === 1 ? "" : "s"}.`
                : "Watch live as Churnhound scans recent posts, scores buyer frustration with Gemini, and enriches contacts in real time."}
            </p>
          </div>

          <div className="flex items-center gap-3 text-right">
            {metrics.isComplete ? (
              <ShieldCheck className="h-8 w-8 text-primary" />
            ) : (
              <Radar className="h-8 w-8 animate-spin text-primary" />
            )}
            <div>
              <div className="font-mono text-2xl font-semibold tabular-nums">
                {metrics.progressPercent}%
              </div>
              <div className="text-xs text-muted-foreground">
                {metrics.isComplete ? "Completed" : "Scanning live"}
              </div>
            </div>
          </div>
        </div>

        {/* Active Target + Progress Bar */}
        <div className="space-y-3 border-t border-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 font-medium">
              {!metrics.isComplete && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
              <span>
                {metrics.isComplete ? "Status: " : "Now scanning: "}
                <strong className="font-semibold text-foreground">
                  {currentCompetitorDisplay}
                </strong>
              </span>
            </div>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {metrics.processedCompetitors} / {metrics.totalCompetitors} processed
            </span>
          </div>

          <div
            role="progressbar"
            aria-label="First run competitor scan progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={metrics.progressPercent}
            className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
          >
            <div
              className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out"
              style={{ transform: `scaleX(${Math.max(0.02, metrics.progressPercent / 100)})` }}
            />
          </div>

          {/* 3-Step Gamified Milestone Strip */}
          <div className="grid gap-3 pt-2 sm:grid-cols-3">
            {milestones.map((m, idx) => (
              <div
                key={m.label}
                className={cn(
                  "flex items-center justify-between gap-3 border-t-2 pt-2.5 text-xs",
                  m.done ? "border-primary text-foreground" : "border-border text-muted-foreground",
                )}
              >
                <span className="font-medium">
                  0{idx + 1}. {m.label}
                </span>
                <span className="font-mono tabular-nums">{m.detail}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Real-time Telemetry Grid matching Admin metrics */}
        <div className="grid grid-cols-2 gap-4 border-t border-border pt-5 sm:grid-cols-4">
          <div>
            <div className="text-xs text-muted-foreground">Posts Found</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums md:text-3xl">
              {formatStatValue(metrics.totalPostsFound)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Leads Saved</div>
            <div className="mt-1 font-mono text-2xl font-bold text-primary tabular-nums md:text-3xl">
              {formatStatValue(metrics.leadsSaved)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Discarded</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums md:text-3xl">
              {formatStatValue(metrics.discarded)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Competitor Index</div>
            <div className="mt-1 font-mono text-2xl font-bold tabular-nums md:text-3xl">
              {metrics.processedCompetitors}/{metrics.totalCompetitors}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums">
          <span>Relevant mentions {formatStatValue(status.stats.relevant)}</span>
          <span aria-hidden="true">·</span>
          <span>Emails found {formatStatValue(status.stats.emails)}</span>
          <span aria-hidden="true">·</span>
          <span>LinkedIn matched {formatStatValue(status.stats.linkedin)}</span>
          {status.sources && status.sources.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Active sources:{" "}
                {status.sources
                  .filter((s) => s.status === "ok" && s.count > 0)
                  .map((s) => `${platformLabel(s.platform)} (${s.count})`)
                  .join(", ") || `${status.sources.length} checked`}
              </span>
            </>
          )}
        </div>

        {/* Pipeline Stage Tracker */}
        <div className="space-y-2.5 border-t border-border pt-5">
          {stepItems.map((s) => {
            const idx = activeOrder.indexOf(s.key);
            const done = currentStepIdx > idx || metrics.isComplete;
            const active = !done && currentStepIdx === idx;
            return (
              <div key={s.key} className="flex items-center gap-3 text-sm">
                {done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                ) : active ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className={done || active ? "text-foreground" : "text-muted-foreground"}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Live Log Feed */}
        <div className="space-y-2 border-t border-border pt-5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Terminal className="h-3.5 w-3.5 text-primary" />
              Live Scan Feed
            </span>
            <span className="tabular-nums">Refreshing every 2.5s</span>
          </div>
          <div
            ref={logContainerRef}
            aria-live="polite"
            className="h-44 overflow-y-auto rounded-lg border border-border bg-secondary/60 p-3 font-mono text-xs leading-relaxed"
          >
            {logs.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2.5 py-0.5">
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {entry.timestamp}
                </span>
                <span
                  className={cn(
                    entry.tone === "success"
                      ? "font-medium text-primary"
                      : entry.tone === "warn"
                        ? "text-amber-700 dark:text-amber-300"
                        : "text-foreground",
                  )}
                >
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Phase 3 CTA Footer */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <span>
              {metrics.isComplete
                ? "All done! Head to your dashboard to explore your leads and set your daily schedule."
                : metrics.canViewDashboard
                  ? "Your initial batch is ready! You can enter the dashboard now while remaining competitors finish in the background."
                  : "Waiting for the first 3 competitors (or completion) before unlocking your dashboard..."}
            </span>
          </div>

          {metrics.canViewDashboard && (
            <Button
              type="button"
              variant="hero"
              size="lg"
              onClick={() => onViewDashboard(!metrics.isComplete)}
              className="ml-auto whitespace-nowrap shrink-0"
            >
              View Dashboard
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

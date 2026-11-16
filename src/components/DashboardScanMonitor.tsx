import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Play, Radar, RefreshCw, Square, Terminal, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  computeFirstRunProgress,
  diffScrapeStatusLogs,
  formatStatValue,
  type FirstRunLogEntry,
  type ScrapeStatusSnapshot,
} from "@/lib/pipeline";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 2500;
const INITIAL_SCAN_STORAGE_KEY = "churnhound_initial_scan_active";

interface DashboardScanMonitorProps {
  competitors: Array<{ id: string; name: string }>;
  onRunningChange?: (running: boolean) => void;
  startTriggerCount?: number;
}

function readInitialHandedOff(): boolean {
  if (typeof window === "undefined") return false;
  const raw = window.sessionStorage.getItem(INITIAL_SCAN_STORAGE_KEY);
  if (!raw) return false;
  const ts = Number(raw);
  return Number.isFinite(ts) && Date.now() - ts < 15 * 60_000;
}

export function DashboardScanMonitor({
  competitors,
  onRunningChange,
  startTriggerCount = 0,
}: DashboardScanMonitorProps) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ScrapeStatusSnapshot | null>(null);
  const [logs, setLogs] = useState<FirstRunLogEntry[]>([]);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [handedOffFromOnboarding, setHandedOffFromOnboarding] =
    useState<boolean>(readInitialHandedOff);
  const [showCompletionCard, setShowCompletionCard] = useState(false);

  const prevStatusRef = useRef<ScrapeStatusSnapshot | null>(null);
  const lastSavedRef = useRef<number>(0);
  const seqRef = useRef<number>(1);
  const isPollingRef = useRef<boolean>(false);
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const lastTriggerRef = useRef<number>(startTriggerCount);

  const applyPollStatus = useCallback(
    (next: ScrapeStatusSnapshot) => {
      const prev = prevStatusRef.current;

      if (prev || next.job_status === "running") {
        const newEntries = diffScrapeStatusLogs(prev, next, new Date(), seqRef.current);
        seqRef.current += newEntries.length + 1;
        if (newEntries.length > 0) {
          setLogs((curr) => [...curr.slice(-60), ...newEntries]);
        }
      }

      if (next.job_status === "running") {
        setDismissed(false);
        setShowCompletionCard(false);
      } else if (next.job_status === "completed") {
        if (prev?.job_status === "running" || handedOffFromOnboarding) {
          setShowCompletionCard(true);
        }
      }

      prevStatusRef.current = next;
      setStatus(next);

      const savedCount = Number.isFinite(next.stats?.saved) ? next.stats.saved : 0;
      if (
        savedCount > lastSavedRef.current ||
        (prev?.job_status === "running" && next.job_status === "completed")
      ) {
        lastSavedRef.current = Math.max(lastSavedRef.current, savedCount);
        void qc.invalidateQueries({ queryKey: ["leads"] });
        void qc.invalidateQueries({ queryKey: ["stats"] });
      }
    },
    [handedOffFromOnboarding, qc],
  );

  const fetchStatus = useCallback(async () => {
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
      console.warn("[DashboardScanMonitor] scrape-status poll warning:", err);
    } finally {
      isPollingRef.current = false;
    }
  }, [applyPollStatus]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    onRunningChange?.(status?.job_status === "running" || starting);
  }, [status?.job_status, starting, onRunningChange]);

  useEffect(() => {
    if (status?.job_status !== "running") return;
    const timer = window.setInterval(() => {
      void fetchStatus();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [status?.job_status, fetchStatus]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const startScan = useCallback(async () => {
    if (competitors.length === 0) {
      toast.info("Add at least one competitor first.");
      return;
    }
    setStarting(true);
    setDismissed(false);
    setShowCompletionCard(false);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
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
          competitor_ids: competitors.map((c) => c.id),
          platform: "all",
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        started?: boolean;
        resumed?: boolean;
        status?: ScrapeStatusSnapshot;
        error?: string;
      };

      if (!res.ok || !payload.ok || !payload.status) {
        throw new Error(payload.error || `Failed to start scan (HTTP ${res.status})`);
      }

      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(INITIAL_SCAN_STORAGE_KEY, String(Date.now()));
      }
      setHandedOffFromOnboarding(true);
      lastSavedRef.current = payload.status.stats?.saved ?? 0;
      prevStatusRef.current = null;
      setLogs(diffScrapeStatusLogs(null, payload.status, new Date(), seqRef.current));
      seqRef.current += 5;
      setStatus(payload.status);
      toast.success(
        payload.started ? "Live competitor scan started." : "Connected to active scan.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start scan.");
    } finally {
      setStarting(false);
    }
  }, [competitors]);

  useEffect(() => {
    if (startTriggerCount > lastTriggerRef.current) {
      lastTriggerRef.current = startTriggerCount;
      void startScan();
    }
  }, [startTriggerCount, startScan]);

  async function stopScan() {
    setCancelling(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        toast.error("Session expired — please sign in again.");
        return;
      }
      const res = await fetch("/api/admin/scrape-cancel", {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        status?: ScrapeStatusSnapshot;
        error?: string;
      };
      if (!res.ok || !payload.ok || !payload.status) {
        throw new Error(payload.error || `Failed to stop scan (HTTP ${res.status})`);
      }

      prevStatusRef.current = payload.status;
      setStatus(payload.status);
      setShowCompletionCard(true);
      toast.info("Scan stopped. You can restart it anytime.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to stop scan.");
    } finally {
      setCancelling(false);
    }
  }

  function handleDismiss() {
    setDismissed(true);
    setShowCompletionCard(false);
    setHandedOffFromOnboarding(false);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(INITIAL_SCAN_STORAGE_KEY);
    }
  }

  const isRunning = status?.job_status === "running";
  const isCompleted = status?.job_status === "completed";
  const metrics = useMemo(
    () =>
      status ? computeFirstRunProgress(status, Math.max(1, competitors.length), 0, false) : null,
    [status, competitors.length],
  );

  // Stay prominently expanded whenever a scan is actively running (never minimize when leads > 0),
  // or when a completed scan card is awaiting user review/dismissal.
  if (!isRunning && (!isCompleted || !showCompletionCard || dismissed)) {
    return null;
  }

  if (!status || !metrics) return null;

  const wasStopped = Boolean(status.errors?.some((e) => /stopped/i.test(e)));
  const activeIndexDisplay = isRunning
    ? Math.min(metrics.processedCompetitors + 1, metrics.totalCompetitors)
    : metrics.totalCompetitors;

  return (
    <section
      aria-label="Live competitor scan monitor"
      className="glass space-y-5 border-primary/30 p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums">
            {isRunning ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                <Radar className="h-3.5 w-3.5 animate-spin" />
                Live Competitor Scan Running
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {wasStopped ? "Competitor Scan Stopped" : "Competitor Scan Complete"}
              </span>
            )}
            <span aria-hidden="true">·</span>
            <span>
              Competitor {activeIndexDisplay} of {metrics.totalCompetitors}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono font-semibold text-foreground">
              {metrics.progressPercent}%
            </span>
          </div>

          <h2 className="font-display text-lg font-semibold tracking-tight sm:text-xl">
            {isRunning
              ? status.current_competitor_name
                ? `Scanning ${status.current_competitor_name}…`
                : "Scanning competitors across social & review sites…"
              : wasStopped
                ? `Scan paused after saving ${formatStatValue(metrics.leadsSaved)} lead${metrics.leadsSaved === 1 ? "" : "s"}`
                : `Finished scanning ${metrics.totalCompetitors} competitor${metrics.totalCompetitors === 1 ? "" : "s"} — ${formatStatValue(metrics.leadsSaved)} lead${metrics.leadsSaved === 1 ? "" : "s"} saved`}
          </h2>

          <p className="text-xs text-muted-foreground">
            {isRunning
              ? "Leads appear automatically below as each competitor finishes. Feel free to browse while this runs."
              : "You can restart a fresh scan anytime or dismiss this banner."}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isRunning ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={cancelling}
              onClick={() => void stopScan()}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {cancelling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Square className="h-3.5 w-3.5" />
              )}
              {cancelling ? "Stopping…" : "Stop Scan"}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={starting || competitors.length === 0}
                onClick={() => void startScan()}
              >
                {starting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Restart Scan
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Dismiss scan summary"
                onClick={handleDismiss}
              >
                <X className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div
          role="progressbar"
          aria-label="Competitor scan progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={metrics.progressPercent}
          className="h-2 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div
            className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-500 ease-out"
            style={{ transform: `scaleX(${Math.max(0.02, metrics.progressPercent / 100)})` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {isRunning
              ? status.step === "analyzing"
                ? "Analyzing posts with Gemini & enriching contacts"
                : "Fetching recent complaints across platforms"
              : "Scan idle"}
          </span>
          <span className="font-mono">
            {metrics.processedCompetitors} / {metrics.totalCompetitors} processed
          </span>
        </div>
      </div>

      {/* Live Counters */}
      <div className="grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted-foreground">Posts Found</div>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">
            {formatStatValue(metrics.totalPostsFound)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Leads Saved</div>
          <div className="mt-0.5 font-mono text-xl font-bold text-primary tabular-nums">
            {formatStatValue(metrics.leadsSaved)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Emails Found</div>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">
            {formatStatValue(status.stats.emails)}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">LinkedIn Matched</div>
          <div className="mt-0.5 font-mono text-xl font-bold tabular-nums">
            {formatStatValue(status.stats.linkedin)}
          </div>
        </div>
      </div>

      {/* Live Activity Feed */}
      {logs.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5 font-medium text-foreground">
              <Terminal className="h-3.5 w-3.5 text-primary" />
              Live Activity
            </span>
            {isRunning && <span className="tabular-nums">Updating every 2.5s</span>}
          </div>
          <div
            ref={logContainerRef}
            aria-live="polite"
            className="max-h-32 overflow-y-auto rounded-lg border border-border bg-secondary/50 p-2.5 font-mono text-xs leading-relaxed"
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
      )}
    </section>
  );
}

export function DashboardScanButton({
  running,
  disabled,
  onClick,
}: {
  running: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  if (running) return null;
  return (
    <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={onClick}>
      <Play className="h-3.5 w-3.5" />
      Run Manual Scan
    </Button>
  );
}

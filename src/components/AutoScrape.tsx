import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatStatValue } from "@/lib/pipeline";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ScrapeProgress {
  date?: string;
  competitors?: number;
  found?: number;
  saved?: number;
}

export function AutoScrape() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["scrape_settings"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data, error } = await supabase
        .from("user_scrape_settings")
        .select("enabled,run_hour,last_run_at,progress,pause_reason")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      const today = new Date().toISOString().slice(0, 10);
      const p = (data?.progress ?? null) as ScrapeProgress | null;
      return {
        enabled: data?.enabled ?? false,
        run_hour: data?.run_hour ?? 6,
        last_run_at: data?.last_run_at ?? null,
        pause_reason: data?.pause_reason ?? null,
        last_result:
          p?.date === today
            ? {
                competitors: p.competitors ?? 0,
                found: p.found ?? 0,
                saved: p.saved ?? 0,
              }
            : null,
      };
    },
  });

  const st = q.data;
  const [runHour, setRunHour] = useState<number>(6);
  const [enabled, setEnabled] = useState<boolean>(false);

  useEffect(() => {
    if (!st) return;
    setRunHour(st.run_hour);
    setEnabled(st.enabled);
  }, [st]);

  const mutation = useMutation({
    mutationFn: async (patch: { enabled: boolean; run_hour: number }) => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Please sign in again.");
      const { error } = await supabase.from("user_scrape_settings").upsert(
        {
          user_id: user.id,
          enabled: patch.enabled,
          run_hour: patch.run_hour,
          ...(patch.enabled ? { pause_reason: null } : {}),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["scrape_settings"] });
      toast.success("Saved");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not save");
    },
  });

  const local = (h: number) => {
    const d = new Date();
    d.setUTCHours(h, 0, 0, 0);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  return (
    <div className="glass space-y-3 p-5">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1">
          <div className="font-bold">Automatic daily scrape</div>
          <div className="text-sm text-muted-foreground">
            Scans all your competitors on every platform once a day, automatically.
          </div>
        </div>
        <Select
          value={String(runHour)}
          onValueChange={(v) => setRunHour(Number(v))}
          disabled={q.isLoading || mutation.isPending}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 24 }, (_, h) => (
              <SelectItem key={h} value={String(h)}>
                Start {local(h)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Switch
          aria-label="Automatic daily scrape"
          checked={enabled}
          disabled={q.isLoading || mutation.isPending}
          onCheckedChange={(v) => {
            setEnabled(v);
            mutation.mutate({ enabled: v, run_hour: runHour });
          }}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={q.isLoading || mutation.isPending}
          onClick={() => mutation.mutate({ enabled, run_hour: runHour })}
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      {st && (
        <p className="text-sm text-muted-foreground">
          {st.enabled ? "On" : "Off"}
          {st.last_run_at && <> · Last run {new Date(st.last_run_at).toLocaleString()}</>}
          {st.last_result && (
            <>
              {" "}
              · Today: {formatStatValue(st.last_result.competitors)} competitors,{" "}
              {formatStatValue(st.last_result.found)} posts, {formatStatValue(st.last_result.saved)}{" "}
              leads saved
            </>
          )}
        </p>
      )}
      {st?.pause_reason && <p className="text-sm text-destructive">Paused: {st.pause_reason}</p>}
    </div>
  );
}

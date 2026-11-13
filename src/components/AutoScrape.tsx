import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getScrapeSettings, updateScrapeSettings } from "@/lib/leads.functions";
import { formatStatValue } from "@/lib/pipeline";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AutoScrape() {
  const get = useServerFn(getScrapeSettings);
  const save = useServerFn(updateScrapeSettings);
  const q = useQuery({
    queryKey: ["scrape_settings"],
    queryFn: () => get(),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const st = q.data;
  async function update(patch: { enabled?: boolean; run_hour?: number }) {
    if (!st) return;
    try {
      await save({
        data: { enabled: patch.enabled ?? st.enabled, run_hour: patch.run_hour ?? st.run_hour },
      });
      await q.refetch();
      toast.success("Saved");
    } catch {
      toast.error("Could not save");
    }
  }
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
          value={String(st?.run_hour ?? 6)}
          onValueChange={(v) => update({ run_hour: Number(v) })}
          disabled={!st}
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
          checked={!!st?.enabled}
          disabled={!st}
          onCheckedChange={(v) => update({ enabled: v })}
        />
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

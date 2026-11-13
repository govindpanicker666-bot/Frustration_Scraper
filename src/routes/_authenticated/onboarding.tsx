import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { detectCompetitors, type DetectedCompetitor } from "@/lib/leads.functions";
import { competitorsQuery } from "@/lib/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { domainOf } from "@/lib/pipeline";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({
    meta: [
      { title: "Competitors — Churnhound" },
      { name: "description", content: "Pick the competitors to watch." },
      { property: "og:title", content: "Competitors — Churnhound" },
      { property: "og:description", content: "Pick the competitors to watch." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(competitorsQuery),
  component: Onboarding,
});

function Onboarding() {
  const { data: existing } = useSuspenseQuery(competitorsQuery);
  const detect = useServerFn(detectCompetitors);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [list, setList] = useState<(DetectedCompetitor & { on: boolean })[]>([]);
  const [manual, setManual] = useState("");

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await detect({
        data: { company_url: url, company_name: name || undefined, description: desc || undefined },
      });
      if (r.error) toast.error(r.error);
      setList(r.competitors.map((c) => ({ ...c, on: true })));
    } catch {
      toast.error("Could not reach the AI. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function addManual() {
    const n = manual.trim();
    if (!n) return;
    setList((l) => [...l, { name: n, url: "", category: "Added manually", on: true }]);
    setManual("");
  }

  async function save() {
    const picks = list.filter(
      (c) => c.on && !existing.some((e) => e.name.toLowerCase() === c.name.toLowerCase()),
    );
    if (!picks.length) {
      toast.info("Nothing new to save");
      return;
    }
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("competitors").insert(
      picks.map((c) => ({
        user_id: user!.id,
        name: c.name,
        url: c.url || null,
        category: c.category,
        domain: domainOf(c.url),
        description: c.description ?? null,
        keywords: c.keywords ?? [],
      })),
    );
    setSaving(false);
    if (error) {
      toast.error("Could not save competitors");
      return;
    }
    toast.success(`Saved ${picks.length} competitors`);
    await qc.invalidateQueries({ queryKey: ["competitors"] });
    navigate({ to: "/dashboard" });
  }

  async function remove(id: string) {
    await supabase.from("competitors").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["competitors"] });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Competitors</h1>
        <p className="text-muted-foreground">
          Tell us who you are. AI suggests at least 40 competitors to watch.
        </p>
      </div>
      <form onSubmit={run} className="glass flex flex-col gap-3 p-5">
        <div className="flex flex-col gap-3 md:flex-row">
          <Input
            placeholder="Company name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="md:w-56"
          />
          <Input
            placeholder="yourcompany.com"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button type="submit" variant="hero" disabled={loading}>
            {loading ? <Loader2 className="animate-spin" /> : <Wand2 />}
            {list.length ? "Re-detect competitors" : "Detect competitors"}
          </Button>
        </div>
        <textarea
          placeholder="What does your company do and who is it for? (optional, helps a lot for new startups)"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          maxLength={2000}
          rows={3}
          className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </form>

      {list.length > 0 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {list.map((c, i) => (
              <motion.button
                type="button"
                key={c.name + i}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.02 }}
                onClick={() => setList((l) => l.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))}
                className={cn(
                  "glass relative p-4 text-left transition-all",
                  c.on ? "border-primary/60 shadow-glow" : "opacity-50",
                )}
              >
                <span
                  className={cn(
                    "absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border",
                    c.on && "border-primary bg-primary text-primary-foreground",
                  )}
                >
                  {c.on && <Check className="h-3 w-3" />}
                </span>
                <div className="pr-6 font-bold">{c.name}</div>
                <div className="text-xs text-muted-foreground">{c.category}</div>
                {c.description && <div className="mt-1 line-clamp-2 text-xs">{c.description}</div>}
                {c.url && (
                  <div className="mt-1 truncate text-xs text-indigo">
                    {c.url.replace(/^https?:\/\//, "")}
                  </div>
                )}
              </motion.button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <Input
              placeholder="Add a competitor manually"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addManual())}
              className="max-w-xs"
            />
            <Button variant="secondary" onClick={addManual}>
              <Plus />
              Add
            </Button>
            <Button variant="hero" className="ml-auto" disabled={saving} onClick={save}>
              Save {list.filter((c) => c.on).length} competitors
            </Button>
          </div>
        </div>
      )}

      {existing.length > 0 && (
        <div className="glass p-5">
          <h2 className="mb-3 font-bold">Currently tracking ({existing.length})</h2>
          <div className="flex flex-wrap gap-2">
            {existing.map((c) => (
              <span
                key={c.id}
                className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-sm"
              >
                {c.name}
                <button onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`}>
                  <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

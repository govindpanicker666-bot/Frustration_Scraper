import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import type { Json } from "@/integrations/supabase/types";

// Called every 10 minutes. For each user with the daily scan on whose run hour (UTC) has passed,
// scrape ONE of their competitors not yet done today (all platforms), so runs stay short and resumable.
const MAX_PER_DAY = 60;
const USERS_PER_TICK = 3;

type Progress = {
  date: string;
  done: string[];
  competitors: number;
  found: number;
  saved: number;
  current_competitor_index?: Json;
  job_status?: Json;
  manual_job?: Json;
  brand_listening_date?: string;
  [key: string]: Json | undefined;
};

export const Route = createFileRoute("/api/public/jobs/daily-scrape")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authFailure = await authenticateCronRequest(request);
        if (authFailure) return authFailure;
        const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const { data: users } = await db
          .from("user_scrape_settings")
          .select("*")
          .eq("enabled", true)
          .lte("run_hour", now.getUTCHours())
          .order("last_run_at", { ascending: true, nullsFirst: true });
        const ran: { user: string; competitor?: string; skipped?: string }[] = [];
        for (const st of users ?? []) {
          if (ran.filter((r) => r.competitor).length >= USERS_PER_TICK) break;
          const prev =
            st.progress && typeof st.progress === "object" && !Array.isArray(st.progress)
              ? (st.progress as Progress)
              : null;
          const prog: Progress =
            prev?.date === today
              ? prev
              : {
                  ...(prev ?? {}),
                  date: today,
                  done: [],
                  competitors: 0,
                  found: 0,
                  saved: 0,
                };
          if (st.pause_reason && prev?.date === today) {
            ran.push({ user: st.user_id, skipped: "paused" });
            continue;
          }
          if (st.lock_until && new Date(st.lock_until) > now) continue;
          const { data: comps } = await db
            .from("competitors")
            .select("id")
            .eq("user_id", st.user_id)
            .order("created_at");
          const next =
            prog.done.length < MAX_PER_DAY
              ? (comps ?? []).find((c) => !prog.done.includes(c.id))
              : undefined;
          if (!next) {
            if (prog.brand_listening_date !== today) {
              const { runDailyBrandListeningTick } = await import("@/lib/scrape-jobs.server");
              await runDailyBrandListeningTick(db, st.user_id, today);
            }
            continue;
          }
          prog.done.push(next.id);
          await db
            .from("user_scrape_settings")
            .update({
              lock_until: new Date(now.getTime() + 9 * 60_000).toISOString(),
              progress: prog as unknown as Json,
              pause_reason: null,
            })
            .eq("user_id", st.user_id);
          let pause: string | null = null;
          try {
            const { scrapeCore, analyzeCore } = await import("@/lib/run.server");
            const s = await scrapeCore(db, next.id, "all");
            const a = await analyzeCore(db, next.id, s.reviews);
            prog.competitors++;
            prog.found += s.reviews.length;
            prog.saved += a.saved;
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            console.error("daily-scrape", next.id, m);
            if (m.startsWith("AI_QUOTA")) pause = "AI daily limit reached — resumes tomorrow.";
          }
          await db
            .from("user_scrape_settings")
            .update({
              lock_until: null,
              last_run_at: new Date().toISOString(),
              progress: prog as unknown as Json,
              pause_reason: pause,
            })
            .eq("user_id", st.user_id);
          if (!pause && prog.brand_listening_date !== today) {
            const { runDailyBrandListeningTick } = await import("@/lib/scrape-jobs.server");
            await runDailyBrandListeningTick(db, st.user_id, today);
          }
          ran.push({ user: st.user_id, competitor: next.id });
          if (pause) break; // shared AI key: stop this tick
        }
        return Response.json({ ok: true, ran });
      },
    },
  },
});

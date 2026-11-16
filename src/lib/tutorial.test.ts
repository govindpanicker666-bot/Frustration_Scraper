import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { markTutorialSeenInDb, readTutorialStatus } from "./tutorial.server";

function makeTutorialMockDb(opts: { missingTutorialColumn?: boolean; hasSeen?: boolean }) {
  let hasSeenColumn = Boolean(opts.hasSeen);
  let progress: Record<string, unknown> | null = null;
  const profileUpdates: Record<string, unknown>[] = [];

  const db = {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                if (opts.missingTutorialColumn) {
                  return {
                    data: null,
                    error: {
                      code: "42703",
                      message: "column profiles.has_seen_tutorial does not exist",
                    },
                  };
                }
                return { data: { has_seen_tutorial: hasSeenColumn }, error: null };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            profileUpdates.push(patch);
            if (!opts.missingTutorialColumn && typeof patch["has_seen_tutorial"] === "boolean") {
              hasSeenColumn = patch["has_seen_tutorial"];
            }
            return {
              eq: () => ({
                select: async () =>
                  opts.missingTutorialColumn
                    ? {
                        data: null,
                        error: {
                          code: "PGRST204",
                          message: "Could not find the 'has_seen_tutorial' column",
                        },
                      }
                    : { data: [{ id: "u1" }], error: null },
              }),
            };
          },
          upsert: async (patch: Record<string, unknown>) => {
            profileUpdates.push(patch);
            return { error: null };
          },
        };
      }
      if (table === "user_scrape_settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: progress ? { progress } : null,
                error: null,
              }),
            }),
          }),
          upsert: async (payload: { progress?: Record<string, unknown> }) => {
            progress = payload.progress ?? null;
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  } as unknown as SupabaseClient<Database>;

  return {
    db,
    getHasSeenColumn: () => hasSeenColumn,
    getProgress: () => progress,
    profileUpdates,
  };
}

describe("tutorial status persistence", () => {
  it("defaults to false and updates public.profiles.has_seen_tutorial = true when completed or skipped", async () => {
    const { db, getHasSeenColumn, profileUpdates } = makeTutorialMockDb({ hasSeen: false });

    expect(await readTutorialStatus(db, "u1")).toEqual({ has_seen_tutorial: false });

    const updated = await markTutorialSeenInDb(db, "u1", "user@example.com");
    expect(updated).toEqual({ has_seen_tutorial: true });
    expect(getHasSeenColumn()).toBe(true);
    expect(profileUpdates).toContainEqual({ has_seen_tutorial: true });
    expect(await readTutorialStatus(db, "u1")).toEqual({ has_seen_tutorial: true });
  });

  it("falls back cleanly to user_scrape_settings.progress when profiles.has_seen_tutorial column is absent", async () => {
    const { db, getProgress } = makeTutorialMockDb({ missingTutorialColumn: true });

    expect(await readTutorialStatus(db, "u2")).toEqual({ has_seen_tutorial: false });

    await markTutorialSeenInDb(db, "u2", "user@example.com");
    expect(getProgress()?.["has_seen_tutorial"]).toBe(true);
    expect(await readTutorialStatus(db, "u2")).toEqual({ has_seen_tutorial: true });
  });
});

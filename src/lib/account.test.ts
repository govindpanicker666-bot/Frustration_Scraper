import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  deleteUserAccountInDb,
  submitUserFeedbackInDb,
  syncPendingSignupProfileInDb,
  syncProfileFullNameInDb,
} from "./account.server";

function makeAccountMockDb(opts: {
  missingFullNameCol?: boolean;
  existingProfile?: boolean;
  metaFullName?: string;
  fkErrorOnceOnDelete?: boolean;
  failPageSubmissions?: boolean;
}) {
  let savedFullName: string | null = null;
  let deleteCalls = 0;
  const cleanedTables: string[] = [];
  let detachedBlogPosts = false;
  const insertedSubmissions: Array<Record<string, unknown>> = [];
  let savedSettingsProgress: Record<string, unknown> | null = null;

  const db = {
    auth: {
      admin: {
        getUserById: vi.fn(async (id: string) => ({
          data: {
            user: {
              id,
              email: "alex@example.com",
              user_metadata: opts.metaFullName ? { full_name: opts.metaFullName } : {},
            },
          },
          error: null,
        })),
        deleteUser: vi.fn(async () => {
          deleteCalls++;
          if (opts.fkErrorOnceOnDelete && deleteCalls === 1) {
            return {
              data: null,
              error: { code: "23503", message: "violates foreign key constraint" },
            };
          }
          return { data: { user: null }, error: null };
        }),
      },
    },
    from: (table: string) => {
      if (table === "blog_posts") {
        return {
          update: () => ({
            eq: async () => {
              detachedBlogPosts = true;
              return { error: null };
            },
          }),
        };
      }

      if (table === "page_submissions") {
        return {
          insert: async (row: Record<string, unknown>) => {
            if (opts.failPageSubmissions) {
              return { error: { code: "42P01", message: "relation does not exist" } };
            }
            insertedSubmissions.push(row);
            return { error: null };
          },
        };
      }

      if (table === "user_scrape_settings") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: savedSettingsProgress ? { progress: savedSettingsProgress } : null,
                error: null,
              }),
            }),
          }),
          upsert: async (row: { progress?: Record<string, unknown> }) => {
            savedSettingsProgress = row.progress ?? null;
            return { error: null };
          },
          delete: () => ({
            eq: async () => {
              cleanedTables.push("user_scrape_settings");
              return { error: null };
            },
          }),
        };
      }

      if (table === "profiles") {
        return {
          update: (patch: { full_name?: string }) => ({
            eq: () => ({
              select: async () => {
                if (opts.missingFullNameCol) {
                  return {
                    data: null,
                    error: {
                      code: "PGRST204",
                      message: "Could not find the 'full_name' column",
                    },
                  };
                }
                if (!opts.existingProfile) {
                  return { data: [], error: null };
                }
                savedFullName = patch.full_name ?? null;
                return { data: [{ id: "u1" }], error: null };
              },
            }),
          }),
          upsert: async (patch: { full_name?: string }) => {
            if (opts.missingFullNameCol) {
              return {
                error: { code: "42703", message: "column profiles.full_name does not exist" },
              };
            }
            savedFullName = patch.full_name ?? null;
            return { error: null };
          },
          delete: () => ({
            eq: async () => {
              cleanedTables.push("profiles");
              return { error: null };
            },
          }),
        };
      }

      return {
        delete: () => ({
          eq: async () => {
            cleanedTables.push(table);
            return { error: null };
          },
        }),
      };
    },
  } as unknown as SupabaseClient<Database>;

  return {
    db,
    getSavedFullName: () => savedFullName,
    getDeleteCalls: () => deleteCalls,
    getCleanedTables: () => cleanedTables,
    didDetachBlogPosts: () => detachedBlogPosts,
    getInsertedSubmissions: () => insertedSubmissions,
    getSavedSettingsProgress: () => savedSettingsProgress,
  };
}

describe("account profile full_name sync", () => {
  it("writes full_name to profiles for existing or newly created users", async () => {
    const existing = makeAccountMockDb({ existingProfile: true });
    const res1 = await syncProfileFullNameInDb(existing.db, "u1", "  Alex Morgan  ", "a@b.com");
    expect(res1).toEqual({ ok: true, saved: true });
    expect(existing.getSavedFullName()).toBe("Alex Morgan");

    const upserted = makeAccountMockDb({ existingProfile: false });
    const res2 = await syncProfileFullNameInDb(upserted.db, "u1", "Jamie Lee", "j@b.com");
    expect(res2).toEqual({ ok: true, saved: true });
    expect(upserted.getSavedFullName()).toBe("Jamie Lee");
  });

  it("handles missing profiles.full_name column gracefully without failing signup", async () => {
    const missing = makeAccountMockDb({ missingFullNameCol: true, existingProfile: true });
    const res = await syncProfileFullNameInDb(missing.db, "u1", "Alex Morgan", "a@b.com");
    expect(res).toEqual({ ok: true, saved: false });
  });

  it("only syncs pending signup full_name when it matches verified user_metadata", async () => {
    const mock = makeAccountMockDb({ existingProfile: true, metaFullName: "Alex Morgan" });
    const mismatched = await syncPendingSignupProfileInDb("u1", "Spoofed Name", mock.db);
    expect(mismatched).toEqual({ ok: true, saved: false });
    expect(mock.getSavedFullName()).toBeNull();

    const matched = await syncPendingSignupProfileInDb("u1", "Alex Morgan", mock.db);
    expect(matched).toEqual({ ok: true, saved: true });
    expect(mock.getSavedFullName()).toBe("Alex Morgan");
  });
});

describe("account deletion", () => {
  it("deletes user from auth.users and detaches blog author references", async () => {
    const mock = makeAccountMockDb({});
    const res = await deleteUserAccountInDb("u1", mock.db);
    expect(res).toEqual({ ok: true });
    expect(mock.didDetachBlogPosts()).toBe(true);
    expect(mock.getDeleteCalls()).toBe(1);
    expect(mock.getCleanedTables()).toEqual([]);
  });

  it("cleans up user-owned records and retries auth.admin.deleteUser on foreign key error", async () => {
    const mock = makeAccountMockDb({ fkErrorOnceOnDelete: true });
    const res = await deleteUserAccountInDb("u1", mock.db);
    expect(res).toEqual({ ok: true });
    expect(mock.getDeleteCalls()).toBe(2);
    expect(mock.getCleanedTables()).toContain("leads");
    expect(mock.getCleanedTables()).toContain("competitors");
    expect(mock.getCleanedTables()).toContain("user_scrape_settings");
    expect(mock.getCleanedTables()).toContain("profiles");
  });
});

describe("user feedback submission", () => {
  it("records feedback to both page_submissions and user_scrape_settings backup log", async () => {
    const mock = makeAccountMockDb({});
    const res = await submitUserFeedbackInDb(mock.db, "u1", {
      type: "error",
      subject: "Scan stalled",
      details: "Stuck at step 2 after selecting 5 competitors.",
      pagePath: "/dashboard",
      userEmail: "alex@example.com",
    });

    expect(res).toEqual({ ok: true });
    expect(mock.getInsertedSubmissions()).toHaveLength(1);
    expect(mock.getInsertedSubmissions()[0]).toMatchObject({
      page_id: null,
      name: "[Error Report] Scan stalled",
      email: "alex@example.com",
      company: "/dashboard",
    });

    const prog = mock.getSavedSettingsProgress();
    const log = prog?.["feedback_log"] as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      type: "error",
      subject: "Scan stalled",
      page: "/dashboard",
    });
  });

  it("still succeeds via user_scrape_settings backup when page_submissions insert fails", async () => {
    const mock = makeAccountMockDb({ failPageSubmissions: true });
    const res = await submitUserFeedbackInDb(mock.db, "u1", {
      type: "feedback",
      subject: "Love the filters",
      details: "Would love Slack alerts on high frustration scores.",
      pagePath: "/leads",
    });

    expect(res).toEqual({ ok: true });
    expect(mock.getInsertedSubmissions()).toHaveLength(0);
    const prog = mock.getSavedSettingsProgress();
    const log = prog?.["feedback_log"] as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect(log[0]?.["type"]).toBe("feedback");
  });
});

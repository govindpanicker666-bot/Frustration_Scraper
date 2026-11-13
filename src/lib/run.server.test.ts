import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { analyzeCore } from "./run.server";

const mocks = vi.hoisted(() => ({ geminiJson: vi.fn(), findContact: vi.fn() }));
vi.mock("./ai.server", () => ({ geminiJson: mocks.geminiJson }));
vi.mock("./enrich.server", () => ({ findContact: mocks.findContact }));

describe("negative-only lead analysis", () => {
  it("does not save a normal company mention even if AI assigns score 1", async () => {
    mocks.geminiJson.mockResolvedValue({
      results: [
        {
          index: 0,
          relevant: true,
          score: 1,
          sentiment: "neutral",
          negative_quote: "",
          complaint: "",
          is_person: true,
        },
      ],
    });
    mocks.findContact.mockResolvedValue({ email: null, linkedin: null });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "c",
                user_id: "u",
                name: "CapCut",
                url: "https://capcut.com",
                keywords: [],
              },
            }),
          }),
        }),
        upsert,
      }),
    } as unknown as SupabaseClient<Database>;
    const result = await analyzeCore(client, "c", [
      {
        platform: "bluesky",
        reviewer_name: "Jane Doe",
        reviewer_profile_url: null,
        source_url: "https://bsky.app/post/1",
        text: "Made on CapCut AI Template yesterday.",
        published_at: new Date().toISOString(),
      },
    ]);
    expect(result.saved).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("saves negative Threads post as social_signal with source_url preserved", async () => {
    mocks.geminiJson.mockResolvedValue({
      results: [
        {
          index: 0,
          relevant: true,
          score: 7,
          sentiment: "negative",
          negative_quote: "way too expensive",
          complaint: "High pricing",
          pitch: "Try a simpler alternative.",
          job_title: null,
          company: null,
          is_person: true,
        },
      ],
    });
    mocks.findContact.mockResolvedValue({
      email: null,
      emailStatus: null,
      linkedin: null,
      jobTitle: null,
      company: null,
      companyDomain: null,
      name: "aismr.ka",
    });

    let upsertedRows: Record<string, unknown>[] = [];
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "c",
                user_id: "u",
                name: "Mixpanel",
                url: "https://mixpanel.com",
                domain: "mixpanel.com",
                keywords: [],
              },
            }),
            then: (cb: (v: { data: unknown[]; error: null }) => void) =>
              cb({ data: [], error: null }),
          }),
        }),
        upsert: (rows: Record<string, unknown>[]) => {
          upsertedRows = rows;
          return {
            select: async () => ({ data: rows.map((_, i) => ({ id: String(i) })), error: null }),
          };
        },
      }),
    } as unknown as SupabaseClient<Database>;

    const result = await analyzeCore(client, "c", [
      {
        platform: "threads",
        reviewer_name: "aismr.ka",
        reviewer_profile_url: "https://www.threads.net/@aismr.ka",
        source_url: "https://www.threads.net/@aismr.ka/post/DdgaiIbCKMt",
        text: "Mixpanel is way too expensive for small startups.",
        published_at: new Date().toISOString(),
      },
    ]);

    expect(result.saved).toBe(1);
    expect(result.social).toBe(1);
    expect(upsertedRows[0]).toMatchObject({
      source_platform: "threads",
      source_url: "https://www.threads.net/@aismr.ka/post/DdgaiIbCKMt",
      reviewer_profile_url: "https://www.threads.net/@aismr.ka",
      lead_type: "social_signal",
      linkedin_url: null,
    });
  });
});

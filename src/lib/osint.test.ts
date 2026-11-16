import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { FALLBACK_MODELS } from "./ai.server";
import { runOsintDiscoveryForLead, validateOsintUrls } from "./osint.server";

const enrichMocks = vi.hoisted(() => ({
  findContact: vi.fn(),
  socialProfile: vi.fn(),
}));

vi.mock("./enrich.server", () => ({
  findContact: enrichMocks.findContact,
  socialProfile: enrichMocks.socialProfile,
}));

describe("validateOsintUrls", () => {
  it("keeps only live HTTP 200-299 URLs and discards 404, 403, and timeouts", async () => {
    const fakeFetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("github.com")) {
        return new Response("ok", { status: 200 });
      }
      if (url.includes("dev.to")) {
        return new Response("created", { status: 201 });
      }
      if (url.includes("missing.example")) {
        return new Response("not found", { status: 404 });
      }
      if (url.includes("blocked.example")) {
        return new Response("forbidden", { status: 403 });
      }
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }) as typeof fetch;

    const candidates = [
      "https://github.com/octocat",
      "https://missing.example/octocat",
      "https://blocked.example/octocat",
      "https://timeout.example/octocat",
      "https://dev.to/octocat",
    ];

    const valid = await validateOsintUrls(candidates, fakeFetch, {
      concurrency: 2,
      timeoutMs: 1000,
    });

    expect(valid).toEqual(["https://github.com/octocat", "https://dev.to/octocat"]);
  });

  it("returns an empty array when given no URLs", async () => {
    expect(await validateOsintUrls([])).toEqual([]);
  });
});

describe("ai fallback models & unified Find Contact", () => {
  it("includes gemini-2.5-flash in FALLBACK_MODELS", () => {
    expect(FALLBACK_MODELS).toContain("gemini-2.5-flash");
  });

  it("runs B2B contact lookup for full-name leads on review platforms like G2 and updates the lead", async () => {
    enrichMocks.findContact.mockResolvedValue({
      email: "jane@acme.io",
      emailStatus: "pattern",
      linkedin: "https://www.linkedin.com/in/janedoe",
      jobTitle: "VP Ops",
      company: "Acme",
      companyDomain: "acme.io",
      name: "Jane Doe",
    });

    const leadUpdates: Record<string, unknown>[] = [];
    const fakeDb = {
      from: (table: string) => {
        if (table === "leads") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "11111111-1111-1111-1111-111111111111",
                    user_id: "user-1",
                    competitor_id: "comp-1",
                    competitor_name: "Intercom",
                    source_platform: "g2",
                    source_url: "https://www.g2.com/products/intercom/reviews/12345",
                    reviewer_name: "Jane Doe",
                    reviewer_profile_url: "https://www.g2.com/products/intercom/reviews/12345",
                    email: null,
                    email_status: null,
                    linkedin_url: null,
                    job_title: null,
                    company: null,
                    company_domain: null,
                    lead_type: "social_signal",
                  },
                  error: null,
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              leadUpdates.push(payload);
              return {
                eq: async () => ({ error: null }),
              };
            },
          };
        }
        if (table === "competitors") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { url: "https://intercom.com", domain: "intercom.com" },
                  error: null,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    } as unknown as SupabaseClient<Database>;

    const result = await runOsintDiscoveryForLead(
      fakeDb,
      "user-1",
      "11111111-1111-1111-1111-111111111111",
    );

    expect(enrichMocks.findContact).toHaveBeenCalledTimes(1);
    expect(result.email).toBe("jane@acme.io");
    expect(result.linkedin_url).toBe("https://www.linkedin.com/in/janedoe");
    expect(result.osint_contacts.emails).toContain("jane@acme.io");
    expect(result.osint_contacts.social_profiles.linkedin).toBe(
      "https://www.linkedin.com/in/janedoe",
    );
    expect(leadUpdates[0]).toMatchObject({
      email: "jane@acme.io",
      linkedin_url: "https://www.linkedin.com/in/janedoe",
      lead_type: "email",
      osint_checked: true,
    });
  });
});

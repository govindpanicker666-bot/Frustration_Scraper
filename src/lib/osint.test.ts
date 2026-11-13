import { describe, it, expect } from "vitest";
import { validateOsintUrls } from "./osint.server";

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

import { describe, expect, it } from "vitest";
import {
  computeFirstRunProgress,
  diffScrapeStatusLogs,
  type ScrapeStatusSnapshot,
} from "./pipeline";

function makeSnapshot(overrides: Partial<ScrapeStatusSnapshot> = {}): ScrapeStatusSnapshot {
  return {
    job_id: "job-1",
    job_status: "running",
    current_competitor_index: 0,
    total_competitors: 10,
    current_competitor_name: "Mixpanel",
    step: "fetching",
    stats: {
      found: 0,
      relevant: 0,
      analyzed: 0,
      saved: 0,
      emails: 0,
      linkedin: 0,
      social: 0,
      discarded: 0,
    },
    sources: [],
    errors: [],
    ...overrides,
  };
}

describe("FirstRunScan progress metrics", () => {
  it("tracks competitor index progress and locks View Dashboard until 3 processed or completion", () => {
    const start = computeFirstRunProgress(makeSnapshot({ current_competitor_index: 0 }));
    expect(start.progressPercent).toBe(4);
    expect(start.canViewDashboard).toBe(false);
    expect(start.earlyUnlockReady).toBe(false);

    const two = computeFirstRunProgress(makeSnapshot({ current_competitor_index: 2 }));
    expect(two.progressPercent).toBe(20);
    expect(two.canViewDashboard).toBe(false);

    const three = computeFirstRunProgress(
      makeSnapshot({
        current_competitor_index: 3,
        stats: {
          found: 18,
          relevant: 5,
          analyzed: 5,
          saved: 2,
          emails: 1,
          linkedin: 1,
          social: 2,
          discarded: 3,
        },
      }),
    );
    expect(three.progressPercent).toBe(30);
    expect(three.canViewDashboard).toBe(true);
    expect(three.earlyUnlockReady).toBe(true);
    expect(three.totalPostsFound).toBe(18);
    expect(three.leadsSaved).toBe(2);
    expect(three.discarded).toBe(3);
  });

  it("reaches 100% and unlocks View Dashboard when job completes even with fewer than 3 competitors", () => {
    const done = computeFirstRunProgress(
      makeSnapshot({
        job_status: "completed",
        step: "done",
        current_competitor_index: 2,
        total_competitors: 2,
        current_competitor_name: null,
        stats: {
          found: 14,
          relevant: 3,
          analyzed: 3,
          saved: 3,
          emails: 2,
          linkedin: 2,
          social: 3,
          discarded: 0,
        },
      }),
    );
    expect(done.isComplete).toBe(true);
    expect(done.progressPercent).toBe(100);
    expect(done.processedCompetitors).toBe(2);
    expect(done.canViewDashboard).toBe(true);
    expect(done.earlyUnlockReady).toBe(false);
  });
});

describe("FirstRunScan live log feed diffing", () => {
  it("generates initial log line and incremental real-time logs for posts found, Gemini analysis, and saved leads", () => {
    const t0 = new Date("2026-11-16T05:00:00Z");
    const s0 = makeSnapshot();
    const initialLogs = diffScrapeStatusLogs(null, s0, t0);
    expect(initialLogs).toHaveLength(1);
    expect(initialLogs[0]?.message).toContain("Scanning Mixpanel (1/10)");

    const s1 = makeSnapshot({
      step: "analyzing",
      stats: {
        ...s0.stats,
        found: 12,
      },
    });
    const analyzingLogs = diffScrapeStatusLogs(s0, s1, t0);
    expect(analyzingLogs.map((l) => l.message)).toEqual([
      "Found 12 posts about Mixpanel (12 total scanned)",
      "Gemini analyzing Mixpanel mentions for frustration & buying signals...",
    ]);

    const s2 = makeSnapshot({
      current_competitor_index: 3,
      current_competitor_name: "Amplitude",
      step: "fetching",
      stats: {
        ...s1.stats,
        saved: 2,
        discarded: 1,
        emails: 1,
      },
    });
    const savedLogs = diffScrapeStatusLogs(s1, s2, t0);
    expect(savedLogs.some((l) => l.message.includes("Qualified lead saved! (+2 new"))).toBe(true);
    expect(savedLogs.some((l) => l.message.includes("Filtered out 1 non-lead post"))).toBe(true);
    expect(savedLogs.some((l) => l.message.includes("Contact enrichment discovered 1 email"))).toBe(
      true,
    );
    expect(savedLogs.some((l) => l.message.includes("3 competitors processed"))).toBe(true);
    expect(savedLogs.some((l) => l.message.includes("Now scanning Amplitude (4/10)"))).toBe(true);
  });
});

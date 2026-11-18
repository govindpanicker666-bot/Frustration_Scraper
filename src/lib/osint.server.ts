import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  buildOsintStructuredContacts,
  decideLead,
  domainOf,
  extractOsintEmailsAndPhones,
  extractOsintHandle,
  filterB2BProfileUrls,
  isFullName,
  mergeOsintUrls,
  parseAliensEyeOutput,
  parseLinkookOutput,
  type B2BSocialPlatform,
  type OsintStructuredContacts,
} from "./pipeline";

const execFileAsync = promisify(execFile);

export interface OsintDiscoveryResult {
  leadId: string;
  handle: string | null;
  osint_checked: true;
  emails: string[];
  social_profiles: Partial<Record<B2BSocialPlatform, string>>;
  other_contacts: string[];
  osint_contacts: OsintStructuredContacts;
  email: string | null;
  email_status: string | null;
  linkedin_url: string | null;
  job_title: string | null;
  company: string | null;
  company_domain: string | null;
  reviewer_name: string | null;
  reviewer_profile_url: string | null;
  lead_type: string;
  persistedToLeadsTable: boolean;
}

interface ScannerRunResult {
  urls: string[];
  rawTexts: string[];
}

export function guessProfileUrl(platform: string, sourceUrl: string, name: string | null): string | null {
  const cleanHandle = (name ?? "").trim().replace(/^@+/, "");
  if (platform === "bluesky") {
    const h = sourceUrl.match(/profile\/([^/?#]+)/)?.[1];
    return h ? `https://bsky.app/profile/${h}` : null;
  }
  if (platform === "mastodon") {
    const m = sourceUrl.match(/^(https?:\/\/[^/]+\/@[^/?#]+)/);
    return m?.[1] ?? null;
  }
  if (platform === "hackernews" && cleanHandle && !/\s/.test(cleanHandle)) {
    return `https://news.ycombinator.com/user?id=${cleanHandle}`;
  }
  if (platform === "github") {
    const u = sourceUrl.match(/github\.com\/([^/?#]+)/)?.[1];
    const ghHandle =
      u && !["orgs", "topics", "search", "explore", "marketplace", "settings"].includes(u)
        ? u
        : cleanHandle && !/\s/.test(cleanHandle)
          ? cleanHandle
          : null;
    return ghHandle ? `https://github.com/${ghHandle}` : null;
  }
  if (platform === "reddit") {
    const u = sourceUrl.match(/reddit\.com\/(?:u|user)\/([^/?#]+)/)?.[1];
    const rdHandle = u ?? (cleanHandle && !/\s/.test(cleanHandle) ? cleanHandle : null);
    return rdHandle ? `https://www.reddit.com/user/${rdHandle}` : null;
  }
  if (platform === "threads") {
    const u = sourceUrl.match(/threads\.(?:net|com)\/@([^/?#]+)/)?.[1];
    const thHandle = u ?? (cleanHandle && !/\s/.test(cleanHandle) ? cleanHandle : null);
    return thHandle ? `https://www.threads.net/@${thHandle}` : null;
  }
  if (platform === "x") {
    const u = sourceUrl.match(/(?:x|twitter)\.com\/([^/?#]+)/)?.[1];
    const xHandle =
      u && !["i", "search", "explore", "home", "intent", "hashtag"].includes(u.toLowerCase())
        ? u
        : cleanHandle && !/\s/.test(cleanHandle)
          ? cleanHandle
          : null;
    return xHandle ? `https://x.com/${xHandle}` : null;
  }
  if (platform === "linkedin") {
    const li = sourceUrl.match(/https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[^/?#]+/i)?.[0];
    return li ?? null;
  }
  return null;
}

function isMissingOsintColumnError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return (
    err.code === "42703" ||
    err.code === "PGRST204" ||
    /osint_contacts|osint_checked|schema cache|column .* does not exist/i.test(err.message ?? "")
  );
}

async function saveFallbackOsintCache(
  db: SupabaseClient<Database>,
  userId: string,
  leadId: string,
  contacts: OsintStructuredContacts,
): Promise<void> {
  const { data } = await db
    .from("user_scrape_settings")
    .select("progress")
    .eq("user_id", userId)
    .maybeSingle();

  const existing =
    data?.progress && typeof data.progress === "object" && !Array.isArray(data.progress)
      ? (data.progress as Record<string, unknown>)
      : {};

  const prevCache =
    existing["osint_cache"] &&
    typeof existing["osint_cache"] === "object" &&
    !Array.isArray(existing["osint_cache"])
      ? (existing["osint_cache"] as Record<string, unknown>)
      : {};

  const nextProgress = {
    ...existing,
    osint_cache: {
      ...prevCache,
      [leadId]: {
        osint_checked: true,
        osint_contacts: contacts,
        checked_at: new Date().toISOString(),
      },
    },
  };

  await db.from("user_scrape_settings").upsert(
    {
      user_id: userId,
      progress: nextProgress as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
}

export async function runLinkookScanner(
  handle: string,
  excludeUrls: Array<string | null | undefined>,
): Promise<ScannerRunResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "linkook-"));
  try {
    const args = [handle, "--no-color", "--show-summary", "--scan-all", "--neo4j", "-o", tempDir];
    let stdout = "";
    try {
      const res = await execFileAsync("linkook", args, {
        cwd: tempDir,
        env: process.env,
        timeout: 35_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      stdout = res.stdout ?? "";
    } catch (execErr) {
      const errObj = execErr as { stdout?: string; stderr?: string; message?: string };
      stdout = typeof errObj.stdout === "string" ? errObj.stdout : "";
      console.warn("[OSINT][linkook] warning/error:", errObj.stderr || errObj.message);
    }

    let neo4jJson: string | null = null;
    try {
      neo4jJson = await readFile(path.join(tempDir, "neo4j_export.json"), "utf8");
    } catch {
      /* neo4j_export.json might not exist if 0 accounts were found */
    }

    return {
      urls: parseLinkookOutput(stdout, neo4jJson, excludeUrls),
      rawTexts: [stdout, neo4jJson ?? ""].filter(Boolean),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runAliensEyeScanner(
  handle: string,
  excludeUrls: Array<string | null | undefined>,
): Promise<ScannerRunResult> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aliens-eye-"));
  try {
    const args = [
      handle,
      "--profile",
      "quick",
      "--catalog",
      "standard",
      "--no-nsfw",
      "--only-found",
      "--format",
      "json",
      "--json-stdout",
      "--output",
      tempDir,
      "-c",
      "60",
    ];

    let stdout = "";
    try {
      const res = await execFileAsync("aliens_eye", args, {
        cwd: tempDir,
        env: process.env,
        timeout: 35_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      stdout = res.stdout ?? "";
    } catch (execErr) {
      const errObj = execErr as { stdout?: string; stderr?: string; message?: string };
      stdout = typeof errObj.stdout === "string" ? errObj.stdout : "";
      console.warn("[OSINT][aliens_eye] warning/error:", errObj.stderr || errObj.message);
    }

    let jsonFileText: string | null = null;
    try {
      const files = await readdir(tempDir);
      const reportFile = files.find((f) => f.endsWith(".json"));
      if (reportFile) {
        jsonFileText = await readFile(path.join(tempDir, reportFile), "utf8");
      }
    } catch {
      /* report JSON may not exist if command timed out early */
    }

    return {
      urls: parseAliensEyeOutput(stdout, jsonFileText, excludeUrls),
      rawTexts: [stdout, jsonFileText ?? ""].filter(Boolean),
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Validates candidate OSINT URLs via HTTP GET, keeping only live 200-299 responses. */
export async function validateOsintUrls(
  urls: string[],
  fetchImpl: typeof fetch = fetch,
  options: { concurrency?: number; timeoutMs?: number } = {},
): Promise<string[]> {
  if (urls.length === 0) return [];
  const concurrency = Math.max(1, options.concurrency ?? 15);
  const timeoutMs = Math.max(500, options.timeoutMs ?? 4500);
  const kept = new Array<boolean>(urls.length).fill(false);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < urls.length) {
      const idx = cursor++;
      const url = urls[idx];
      if (!url) continue;
      try {
        const res = await fetchImpl(url, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        });
        await res.body?.cancel().catch(() => {});
        if (res.ok) {
          kept[idx] = true;
        }
      } catch {
        /* Discard dead URLs, 404s, 403s, timeouts, and network errors */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()));
  return urls.filter((_, idx) => kept[idx]);
}

export async function runOsintDiscoveryForLead(
  db: SupabaseClient<Database>,
  userId: string,
  leadId: string,
): Promise<OsintDiscoveryResult> {
  const { data: lead, error: fetchError } = await db
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();

  if (fetchError) {
    throw new Error(`Failed to fetch lead: ${fetchError.message}`);
  }
  if (!lead) {
    throw new Error("LEAD_NOT_FOUND");
  }

  const { data: comp } = lead.competitor_id
    ? await db.from("competitors").select("url,domain").eq("id", lead.competitor_id).maybeSingle()
    : { data: null };
  const avoidDomain = comp?.domain ?? domainOf(comp?.url) ?? null;

  const effectiveProfileUrl =
    lead.reviewer_profile_url && lead.reviewer_profile_url !== lead.source_url
      ? lead.reviewer_profile_url
      : guessProfileUrl(lead.source_platform, lead.source_url, lead.reviewer_name);

  const handle = extractOsintHandle(lead.reviewer_name, effectiveProfileUrl);
  let structured: OsintStructuredContacts = {
    emails: [],
    social_profiles: {},
    other_contacts: [],
  };

  const { findContact, socialProfile } = await import("./enrich.server");
  const excludeUrls = [lead.source_url, lead.reviewer_profile_url];

  const [osintRunResult, b2bContact] = await Promise.all([
    handle
      ? Promise.all([
          runAliensEyeScanner(handle, excludeUrls),
          runLinkookScanner(handle, excludeUrls),
        ])
      : Promise.resolve(null),
    findContact(
      {
        platform: lead.source_platform,
        name: lead.reviewer_name,
        profileUrl: effectiveProfileUrl,
        jobTitle: lead.job_title,
        company: lead.company,
        avoidDomain,
      },
      isFullName,
    ).catch(() => null),
  ]);

  if (osintRunResult) {
    const [aliensRes, linkookRes] = osintRunResult;
    const { emails, phones } = extractOsintEmailsAndPhones([
      ...aliensRes.rawTexts,
      ...linkookRes.rawTexts,
    ]);

    // Merge raw URLs, aggressively filter to the B2B whitelist, and collapse multiple URLs per domain
    const mergedRawUrls = mergeOsintUrls([aliensRes.urls, linkookRes.urls], excludeUrls);
    const { orderedUrls: candidateB2BUrls } = filterB2BProfileUrls(mergedRawUrls, excludeUrls, {
      applyFallbackRule: false,
    });

    // Validate only the high-value whitelisted URLs (keep only 200-299 live responses)
    const validatedUrls = await validateOsintUrls(candidateB2BUrls);

    structured = buildOsintStructuredContacts({
      validatedUrls,
      emails,
      phones,
      excludeUrls,
    });
  }

  // If OSINT discovered a GitHub profile URL and B2B enrichment still lacks email/LinkedIn, check GitHub profile API.
  let extraGithubProfile = null;
  if (structured.social_profiles.github && !b2bContact?.email && !lead.email) {
    extraGithubProfile = await socialProfile(
      "github",
      structured.social_profiles.github,
      handle,
    ).catch(() => null);
  }

  const confirmedB2BEmail =
    b2bContact?.email && b2bContact.emailStatus !== "likely"
      ? b2bContact.email
      : (extraGithubProfile?.email ?? null);
  if (confirmedB2BEmail && !structured.emails.includes(confirmedB2BEmail.toLowerCase())) {
    structured = {
      ...structured,
      emails: [...structured.emails, confirmedB2BEmail.toLowerCase()],
    };
  }

  const discoveredLinkedin =
    b2bContact?.linkedin ??
    extraGithubProfile?.linkedin ??
    structured.social_profiles.linkedin ??
    null;
  if (discoveredLinkedin && !structured.social_profiles.linkedin) {
    structured = {
      ...structured,
      social_profiles: {
        ...structured.social_profiles,
        linkedin: discoveredLinkedin,
      },
    };
  }

  const nextEmail =
    lead.email ?? b2bContact?.email ?? extraGithubProfile?.email ?? structured.emails[0] ?? null;
  const nextEmailStatus = lead.email
    ? lead.email_status
    : b2bContact?.email
      ? b2bContact.emailStatus
      : extraGithubProfile?.email
        ? "github"
        : structured.emails[0]
          ? "osint"
          : null;
  const nextLinkedin = lead.linkedin_url ?? discoveredLinkedin;
  const nextJobTitle = lead.job_title ?? b2bContact?.jobTitle ?? null;
  const nextCompany = lead.company ?? b2bContact?.company ?? extraGithubProfile?.company ?? null;
  const nextCompanyDomain =
    lead.company_domain ??
    b2bContact?.companyDomain ??
    domainOf(extraGithubProfile?.website) ??
    null;
  const nextReviewerName =
    b2bContact?.name && isFullName(b2bContact.name)
      ? b2bContact.name
      : extraGithubProfile?.name && isFullName(extraGithubProfile.name)
        ? extraGithubProfile.name
        : lead.reviewer_name;
  const nextProfileUrl = effectiveProfileUrl ?? lead.reviewer_profile_url;
  const nextLeadType =
    decideLead({
      platform: lead.source_platform,
      email: nextEmail,
      linkedin: nextLinkedin,
      threadUrl: lead.source_url,
    }) ?? lead.lead_type;

  const standardLeadPatch: Database["public"]["Tables"]["leads"]["Update"] = {
    email: nextEmail,
    email_status: nextEmailStatus,
    linkedin_url: nextLinkedin,
    job_title: nextJobTitle,
    company: nextCompany,
    company_domain: nextCompanyDomain,
    reviewer_name: nextReviewerName,
    reviewer_profile_url: nextProfileUrl,
    lead_type: nextLeadType,
  };

  const { error: updateErr } = await db
    .from("leads")
    .update({
      ...standardLeadPatch,
      osint_contacts: structured,
      osint_checked: true,
    } as unknown as Database["public"]["Tables"]["leads"]["Update"])
    .eq("id", leadId);

  let persistedToLeadsTable = true;
  if (updateErr) {
    if (isMissingOsintColumnError(updateErr)) {
      persistedToLeadsTable = false;
      console.warn(
        "[OSINT] leads table is missing osint_contacts/osint_checked columns; storing fallback in user_scrape_settings.progress.osint_cache",
      );
      await db.from("leads").update(standardLeadPatch).eq("id", leadId);
      await saveFallbackOsintCache(db, userId, leadId, structured);
    } else {
      throw new Error(`Failed to update lead OSINT contacts: ${updateErr.message}`);
    }
  }

  return {
    leadId,
    handle,
    osint_checked: true,
    emails: structured.emails,
    social_profiles: structured.social_profiles,
    other_contacts: structured.other_contacts,
    osint_contacts: structured,
    email: nextEmail,
    email_status: nextEmailStatus,
    linkedin_url: nextLinkedin,
    job_title: nextJobTitle,
    company: nextCompany,
    company_domain: nextCompanyDomain,
    reviewer_name: nextReviewerName,
    reviewer_profile_url: nextProfileUrl,
    lead_type: nextLeadType,
    persistedToLeadsTable,
  };
}

export const runLinkookOsintForLead = runOsintDiscoveryForLead;

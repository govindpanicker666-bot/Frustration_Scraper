import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  extractOsintHandle,
  filterB2BProfileUrls,
  normalizeStoredOsintContacts,
  type B2BSocialPlatform,
  type OsintStructuredContacts,
} from "./pipeline";
import { guessProfileUrl, runLinkookScanner, validateOsintUrls } from "./osint.server";

const execFileAsync = promisify(execFile);
const PYTHON = process.env["PYTHON_EXECUTABLE"]?.trim() || "python3";
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}

async function runOpenLeads(name: string, company: string | null, domain: string | null) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outprey-openleads-"));
  const input = path.join(dir, "lead.csv");
  const output = path.join(dir, "enriched.csv");
  try {
    await writeFile(input, [
      ["name", "company", "domain", "email"].map(csvCell).join(","),
      [name, company ?? "", domain ?? "", ""].map(csvCell).join(","),
    ].join("\n"), "utf8");
    const result = await execFileAsync(PYTHON, ["-m", "openleads", "enrich", input, "-o", output], {
      env: { ...process.env, OPENLEADS_HOME: path.join(dir, "workspace") },
      timeout: 55_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    let csv = "";
    try { csv = await readFile(output, "utf8"); } catch { csv = result.stdout ?? ""; }
    const rows = parseCsv(csv);
    if (rows.length < 2) return null;
    const headers = rows[0]!.map((h) => h.trim().toLowerCase());
    const values = rows[1]!;
    const get = (...keys: string[]) => {
      const index = headers.findIndex((header) => keys.includes(header));
      return index >= 0 ? values[index]?.trim() ?? "" : "";
    };
    const email = get("email").toLowerCase();
    if (!EMAIL_RE.test(email) || get("email tier", "tier").toLowerCase() === "bad") return null;
    const evidence = get("email evidence", "evidence").toLowerCase() || "guessed";
    const tier = get("email tier", "tier").toLowerCase() || "risky";
    const parsedConfidence = Number(get("confidence %", "confidence_pct"));
    const confidence_pct = Number.isFinite(parsedConfidence)
      ? Math.max(0, Math.min(100, parsedConfidence))
      : evidence === "found" ? 90 : evidence === "pattern" ? 70 : 40;
    return { email, evidence, tier, confidence_pct, reasons: get("reasons") || `OpenLeads: ${get("email confidence") || evidence}; score ${get("email score") || "not supplied"}.` };
  } catch (error) {
    console.warn("[email-enrichment][openleads] unavailable or no result:", error);
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

type LeadWithOsint = Database["public"]["Tables"]["leads"]["Row"] & {
  osint_contacts?: unknown;
  osint_checked?: boolean | null;
};

async function saveLead(
  db: SupabaseClient<Database>,
  leadId: string,
  patch: Record<string, unknown>,
) {
  const { error } = await db.from("leads").update(
    patch as Database["public"]["Tables"]["leads"]["Update"],
  ).eq("id", leadId);
  if (error) throw new Error(`Failed to save lead enrichment: ${error.message}`);
}

export async function runEmailEnrichmentForLead(db: SupabaseClient<Database>, leadId: string) {
  const { data: rawLead, error } = await db.from("leads").select("*").eq("id", leadId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!rawLead) throw new Error("LEAD_NOT_FOUND");
  const lead = rawLead as LeadWithOsint;
  if (lead.email) return { email: lead.email, email_status: lead.email_status, email_enrichment: null, osint_contacts: lead.osint_contacts, osint_checked: Boolean(lead.osint_checked) };

  // Do not infer the reviewer domain from the competitor's domain.
  const openLeads = await runOpenLeads(lead.reviewer_name ?? "", lead.company, lead.company_domain);
  let selected = openLeads;
  if (!selected) {
    const profileUrl = lead.reviewer_profile_url && lead.reviewer_profile_url !== lead.source_url
      ? lead.reviewer_profile_url
      : guessProfileUrl(lead.source_platform, lead.source_url, lead.reviewer_name) ?? lead.source_url;
    const handle = extractOsintHandle(lead.reviewer_name, profileUrl);
    if (handle) {
      const linkook = await runLinkookScanner(handle, [lead.source_url, lead.reviewer_profile_url]);
      const email = linkook.urls.find((value) => EMAIL_RE.test(value));
      if (email) selected = {
        email: email.toLowerCase(),
        evidence: "linkook",
        tier: "unverified",
        confidence_pct: 35,
        reasons: "Discovered in Linkook's public username footprint; mailbox ownership has not been independently verified.",
      };
    }
  }

  const existing = normalizeStoredOsintContacts(lead.osint_contacts);
  const metadata = selected ? {
    source: selected.evidence === "linkook" ? "Linkook" : "OpenLeads",
    evidence: selected.evidence,
    tier: selected.tier,
    confidence_pct: selected.confidence_pct,
    reasons: selected.reasons,
  } : null;
  const nextContacts = {
    ...existing,
    emails: selected ? [...new Set([...existing.emails, selected.email])] : existing.emails,
    ...(metadata ? { email_enrichment: metadata } : {}),
  };
  if (selected) {
    await saveLead(db, leadId, {
      email: selected.email,
      email_status: selected.evidence === "linkook" ? "linkook" : `openleads_${selected.evidence}`,
      osint_contacts: nextContacts,
    });
  }
  return {
    email: selected?.email ?? null,
    email_status: selected?.evidence === "linkook" ? "linkook" : selected ? `openleads_${selected.evidence}` : null,
    email_enrichment: metadata,
    osint_contacts: nextContacts,
    osint_checked: Boolean(lead.osint_checked),
  };
}

function collectUrls(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") {
    const matches = value.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
    for (const url of matches) out.add(url.replace(/[),.;]+$/, ""));
    return;
  }
  if (Array.isArray(value)) { for (const item of value) collectUrls(item, out, depth + 1); return; }
  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/url|profile|link/i.test(key)) collectUrls(item, out, depth + 1);
      else if (item && typeof item === "object") collectUrls(item, out, depth + 1);
    }
  }
}

async function runMaigret(handle: string): Promise<string[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "outprey-maigret-"));
  try {
    let stdout = "";
    try {
      const result = await execFileAsync(PYTHON, ["-m", "maigret", handle, "--json", "simple", "--no-progressbar", "--folderoutput", dir], {
        cwd: dir, env: process.env, timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
      });
      stdout = result.stdout ?? "";
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      stdout = err.stdout ?? "";
      console.warn("[profile-search][maigret] warning:", err.stderr || err.message);
    }
    const urls = new Set<string>();
    collectUrls(stdout, urls);
    const files = await import("node:fs/promises").then((fs) => fs.readdir(dir));
    for (const file of files.filter((f) => f.endsWith(".json"))) {
      try { collectUrls(JSON.parse(await readFile(path.join(dir, file), "utf8")), urls); }
      catch { collectUrls(await readFile(path.join(dir, file), "utf8"), urls); }
    }
    return [...urls];
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function runMaigretProfileSearchForLead(db: SupabaseClient<Database>, leadId: string) {
  const { data: rawLead, error } = await db.from("leads").select("*").eq("id", leadId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!rawLead) throw new Error("LEAD_NOT_FOUND");
  const lead = rawLead as LeadWithOsint;
  const profileUrl = lead.reviewer_profile_url && lead.reviewer_profile_url !== lead.source_url
    ? lead.reviewer_profile_url
    : guessProfileUrl(lead.source_platform, lead.source_url, lead.reviewer_name) ?? lead.source_url;
  const handle = extractOsintHandle(lead.reviewer_name, profileUrl);
  if (!handle) return { osint_checked: true, osint_contacts: lead.osint_contacts, social_profiles: {}, emails: [], other_contacts: [], reviewer_profile_url: lead.reviewer_profile_url, linkedin_url: lead.linkedin_url };

  const rawUrls = await runMaigret(handle);
  const { orderedUrls } = filterB2BProfileUrls(rawUrls, [lead.source_url, lead.reviewer_profile_url], { applyFallbackRule: true });
  const liveUrls = await validateOsintUrls(orderedUrls, fetch, { concurrency: 10, timeoutMs: 5000 });
  const { socialProfiles } = filterB2BProfileUrls(liveUrls, [lead.source_url, lead.reviewer_profile_url], { applyFallbackRule: true });
  const previous = normalizeStoredOsintContacts(lead.osint_contacts);
  const mergedProfiles = { ...previous.social_profiles, ...socialProfiles };
  const structured: OsintStructuredContacts = { ...previous, social_profiles: mergedProfiles };
  const linkedin = mergedProfiles.linkedin ?? lead.linkedin_url ?? null;
  const firstProfile = Object.values(mergedProfiles)[0] ?? lead.reviewer_profile_url;
  await saveLead(db, leadId, {
    osint_contacts: structured,
    linkedin_url: linkedin,
    reviewer_profile_url: firstProfile,
  });
  return {
    osint_checked: true,
    osint_contacts: structured,
    social_profiles: mergedProfiles as Partial<Record<B2BSocialPlatform, string>>,
    emails: structured.emails,
    other_contacts: structured.other_contacts,
    reviewer_profile_url: firstProfile,
    linkedin_url: linkedin,
  };
}

import {
  buildEmail,
  detectPattern,
  domainOf,
  emailCandidates,
  extractEmails,
  parseLinkedInTitle,
} from "./pipeline";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import { webSearch } from "./search.server";
export const ddgResults = webSearch;

/** Step 2: find the reviewer's LinkedIn and current company. */
export async function findLinkedIn(name: string, jobTitle: string | null) {
  const q = `"${name}"${jobTitle ? ` "${jobTitle}"` : ""} site:linkedin.com/in/`;
  const res = await ddgResults(q);
  await sleep(1200); // be gentle with DuckDuckGo
  const first = name.split(/\s+/)[0]!.toLowerCase();
  const hit = res.find(
    (r) => /linkedin\.com\/in\//.test(r.url) && r.title.toLowerCase().includes(first),
  );
  if (!hit) return null;
  const parsed = parseLinkedInTitle(hit.title);
  let company = parsed.company;
  if (!company)
    company =
      hit.snippet
        .match(/(?:Experience|at)[:\s]+([A-Z][\w&.\- ]{1,40}?)(?:[·|,.]|$)/)?.[1]
        ?.trim() ?? null;
  return {
    url: hit.url.split("?")[0]! as string | null,
    title: parsed.title,
    company,
    domain: null as string | null,
  };
}

/** Company name -> website domain via DuckDuckGo (free). */
export async function findCompanyDomain(
  company: string,
  avoid: string | null,
): Promise<string | null> {
  const res = await ddgResults(`${company} official website`);
  await sleep(1000);
  const bad =
    /linkedin|wikipedia|facebook|twitter|x\.com|crunchbase|glassdoor|indeed|bloomberg|zoominfo|youtube|instagram/;
  for (const r of res) {
    const d = domainOf(r.url);
    if (d && !bad.test(d) && d !== avoid) return d;
  }
  return null;
}

async function hasMx(domain: string): Promise<boolean> {
  try {
    const r = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`,
      { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) },
    );
    const j = (await r.json()) as { Answer?: { type: number }[] };
    return (j.Answer ?? []).some((a) => a.type === 15);
  } catch {
    return false;
  }
}

async function fetchText(url: string): Promise<string> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(7000),
    });
    return r.ok ? await r.text() : "";
  } catch {
    return "";
  }
}

/** Emails published on the company's own site (home, contact, about, team). */
export async function scrapeSiteEmails(domain: string): Promise<string[]> {
  const paths = ["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/company"];
  const pages = await Promise.all(paths.map((p) => fetchText(`https://${domain}${p}`)));
  return [
    ...new Set(
      pages.flatMap((h) => extractEmails(h.replace(/&#64;|\[at\]|\(at\)/gi, "@"), domain)),
    ),
  ];
}

/** Public commit emails on GitHub for this person at this domain (free, no key). */
async function githubEmail(name: string, domain: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://api.github.com/search/commits?q=${encodeURIComponent(`author-name:"${name}" author-email:${domain}`)}&per_page=5`,
      {
        headers: { "User-Agent": UA, Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(7000),
      },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { items?: { commit?: { author?: { email?: string } } }[] };
    return (
      j.items
        ?.map((i) => i.commit?.author?.email?.toLowerCase())
        .find((e) => e?.endsWith("@" + domain)) ?? null
    );
  } catch {
    return null;
  }
}

/** True if a Gravatar account exists for this email (strong sign the inbox is real). */
async function gravatarExists(email: string): Promise<boolean> {
  try {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(email.trim().toLowerCase()),
    );
    const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const r = await fetch(`https://gravatar.com/avatar/${hash}?d=404`, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

/**
 * Step 3: free Hunter-style email finder (no SMTP, which this hosting blocks).
 * Order: published on site -> GitHub commits -> company pattern -> Gravatar-confirmed guess -> first.last guess.
 * Status: found | github | pattern | gravatar | likely
 */
export async function findEmail(
  name: string,
  domain: string,
): Promise<{ email: string; status: string } | null> {
  if (!(await hasMx(domain))) return null;
  const candidates = emailCandidates(name, domain);
  if (!candidates.length) return null;
  const siteEmails = await scrapeSiteEmails(domain);
  const direct = siteEmails.find((e) => candidates.includes(e));
  if (direct) return { email: direct, status: "found" };
  const gh = await githubEmail(name, domain);
  if (gh) return { email: gh, status: "github" };
  const pattern = detectPattern(siteEmails);
  if (pattern) {
    const e = buildEmail(name, domain, pattern);
    if (e) return { email: e, status: "pattern" };
  }
  for (const c of candidates.slice(0, 4))
    if (await gravatarExists(c)) return { email: c, status: "gravatar" };
  return { email: candidates[0]!, status: "likely" };
}

// ---------- Social author profiles (free public APIs) ----------
export interface SocialProfile {
  name: string | null;
  website: string | null;
  email: string | null;
  company: string | null;
  linkedin: string | null;
  bio: string;
}

async function getJsonSafe<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<T | null> {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", ...headers },
      signal: AbortSignal.timeout(7000),
    });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function fromBio(bio: string) {
  const text = bio
    .replace(/&#x2F;/g, "/")
    .replace(/&#x40;|\s\[at\]\s|\(at\)/gi, "@")
    .replace(/<[^>]+>/g, " ");
  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? null;
  const linkedin = text.match(/https?:\/\/(?:[a-z]+\.)?linkedin\.com\/in\/[\w%-]+/i)?.[0] ?? null;
  const website =
    [...text.matchAll(/https?:\/\/[^\s"'<>)]+/gi)]
      .map((m) => m[0])
      .find((u) => !/linkedin|twitter|x\.com|github\.com|bsky|mastodon|ycombinator/.test(u)) ??
    null;
  return { email, linkedin, website };
}

/** Pull name, website, email, LinkedIn from the author's public profile on the platform they posted on. */
export async function socialProfile(
  platform: string,
  profileUrl: string | null,
  handle: string | null,
): Promise<SocialProfile | null> {
  if (!profileUrl) return null;
  if (platform === "github") {
    const login = profileUrl.match(/github\.com\/([^/?#]+)/)?.[1];
    const u = login
      ? await getJsonSafe<{
          name: string | null;
          email: string | null;
          blog: string | null;
          company: string | null;
          bio: string | null;
        }>(`https://api.github.com/users/${login}`, { Accept: "application/vnd.github+json" })
      : null;
    if (!u) return null;
    const b = fromBio(`${u.bio ?? ""} ${u.blog ?? ""}`);
    return {
      name: u.name,
      website: u.blog ? (/^https?:/.test(u.blog) ? u.blog : `https://${u.blog}`) : b.website,
      email: u.email ?? b.email,
      company: u.company?.replace(/^@/, "") ?? null,
      linkedin: b.linkedin,
      bio: u.bio ?? "",
    };
  }
  if (platform === "hackernews") {
    const id = profileUrl.match(/user\?id=([^&]+)/)?.[1] ?? handle;
    const u = id
      ? await getJsonSafe<{ about?: string }>(
          `https://hacker-news.firebaseio.com/v0/user/${id}.json`,
        )
      : null;
    if (!u?.about) return null;
    const b = fromBio(u.about);
    return { name: null, ...b, company: null, bio: u.about };
  }
  if (platform === "bluesky") {
    const h = profileUrl.match(/profile\/([^/?#]+)/)?.[1];
    const u = h
      ? await getJsonSafe<{ displayName?: string; description?: string; handle: string }>(
          `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${h}`,
        )
      : null;
    if (!u) return null;
    const b = fromBio(u.description ?? "");
    const personal = !/\.bsky\.social$/.test(u.handle) ? `https://${u.handle}` : null;
    return {
      name: u.displayName ?? null,
      website: b.website ?? personal,
      email: b.email,
      company: null,
      linkedin: b.linkedin,
      bio: u.description ?? "",
    };
  }
  if (platform === "mastodon") {
    const m = profileUrl.match(/^https?:\/\/([^/]+)\/@([^/?#]+)/);
    const u = m
      ? await getJsonSafe<{
          display_name?: string;
          note?: string;
          fields?: { name: string; value: string }[];
        }>(`https://${m[1]}/api/v1/accounts/lookup?acct=${m[2]}`)
      : null;
    if (!u) return null;
    const b = fromBio(`${u.note ?? ""} ${(u.fields ?? []).map((f) => f.value).join(" ")}`);
    return { name: u.display_name ?? null, ...b, company: null, bio: u.note ?? "" };
  }
  if (platform === "devto") {
    const un = profileUrl.match(/dev\.to\/([^/?#]+)/)?.[1];
    const u = un
      ? await getJsonSafe<{
          name?: string;
          summary?: string;
          website_url?: string;
          github_username?: string;
        }>(`https://dev.to/api/users/by_username?url=${un}`)
      : null;
    if (!u) return null;
    const b = fromBio(u.summary ?? "");
    return {
      name: u.name ?? null,
      website: u.website_url ?? b.website,
      email: b.email,
      company: null,
      linkedin: b.linkedin,
      bio: u.summary ?? "",
    };
  }
  return null;
}

export interface Contact {
  email: string | null;
  emailStatus: string | null;
  linkedin: string | null;
  jobTitle: string | null;
  company: string | null;
  companyDomain: string | null;
  name: string | null;
}

/**
 * Full contact flow for any lead: platform profile -> LinkedIn (DuckDuckGo) -> company domain (DuckDuckGo)
 * -> site emails -> GitHub commits -> company pattern -> Gravatar -> likely guess (MX checked).
 */
export async function findContact(
  x: {
    platform: string;
    name: string | null;
    profileUrl: string | null;
    jobTitle: string | null;
    company: string | null;
    avoidDomain: string | null;
  },
  isFullName: (n: string | null) => boolean,
): Promise<Contact> {
  const c: Contact = {
    email: null,
    emailStatus: null,
    linkedin: null,
    jobTitle: x.jobTitle,
    company: x.company,
    companyDomain: null,
    name: x.name,
  };
  if (x.platform === "threads") return c;
  if (x.platform === "linkedin" && /linkedin\.com\/in\//.test(x.profileUrl ?? ""))
    c.linkedin = x.profileUrl;
  const prof = await socialProfile(x.platform, x.profileUrl, x.name).catch(() => null);
  if (prof) {
    if (prof.name && isFullName(prof.name)) c.name = prof.name;
    if (prof.email) {
      c.email = prof.email;
      c.emailStatus = "profile";
    }
    if (prof.linkedin) c.linkedin = prof.linkedin;
    if (prof.company && !c.company) c.company = prof.company;
    const site = domainOf(prof.website);
    if (site && site !== x.avoidDomain) c.companyDomain = site;
  }
  const full = c.name && isFullName(c.name) ? c.name : null;
  if (full && !c.linkedin) {
    const li = await findLinkedIn(full, c.jobTitle);
    if (li) {
      c.linkedin = li.url;
      c.jobTitle = c.jobTitle ?? li.title;
      c.company = c.company ?? li.company;
    }
  }
  if (full && !c.email) {
    if (!c.companyDomain && c.company)
      c.companyDomain = await findCompanyDomain(c.company, x.avoidDomain);
    if (c.companyDomain) {
      const found = await findEmail(full, c.companyDomain);
      if (found) {
        c.email = found.email;
        c.emailStatus = found.status;
      }
    }
  }
  return c;
}

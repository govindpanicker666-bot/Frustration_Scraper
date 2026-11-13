import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AtSign,
  Briefcase,
  Building2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Linkedin,
  Loader2,
  Mail,
  Phone,
  Radio,
  RefreshCw,
  Share2,
  Trash2,
  UserRound,
  Wand2,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { generatePitchMessage, reenrichContacts } from "@/lib/leads.functions";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { leadsQuery, type Lead } from "@/lib/queries";
import {
  contactAction,
  isOsintEligiblePlatform,
  leadsToCsv,
  normalizeStoredOsintContacts,
  platformLabel,
  PLATFORMS,
  type B2BSocialPlatform,
  type OsintStructuredContacts,
} from "@/lib/pipeline";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/leads")({
  head: () => ({
    meta: [
      { title: "Leads — Churnhound" },
      { name: "description", content: "Frustrated competitor customers ready to switch." },
      { property: "og:title", content: "Leads — Churnhound" },
      { property: "og:description", content: "Frustrated competitor customers ready to switch." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.fetchQuery(leadsQuery),
  component: LeadsPage,
});

const STATUSES = ["New", "Contacted", "Archived"] as const;

function ContactButton({ lead }: { lead: Lead }) {
  const a = contactAction(lead.linkedin_url ?? lead.reviewer_profile_url, lead.source_url);
  if (!a) return null;
  return (
    <Button
      asChild
      size="sm"
      variant={a.kind === "linkedin" ? "default" : "secondary"}
      onClick={(e) => e.stopPropagation()}
    >
      <a href={a.url} target="_blank" rel="noreferrer">
        {a.kind === "linkedin" ? <Linkedin /> : <UserRound />}
        {a.label}
      </a>
    </Button>
  );
}

const EMAIL_SOURCE: Record<string, string> = {
  found: "published on their company site",
  github: "from their public GitHub commits",
  pattern: "matches the company's email format",
  gravatar: "confirmed by a Gravatar account",
  profile: "listed on their public profile",
};

const OSINT_PROFILE_META: Record<
  B2BSocialPlatform,
  {
    label: string;
    icon:
      | "linkedin"
      | "x"
      | "github"
      | "crunchbase"
      | "wellfound"
      | "facebook"
      | "tiktok"
      | "instagram";
  }
> = {
  linkedin: { label: "LinkedIn Profile", icon: "linkedin" },
  twitter: { label: "X Profile", icon: "x" },
  github: { label: "GitHub Profile", icon: "github" },
  crunchbase: { label: "Crunchbase Profile", icon: "crunchbase" },
  wellfound: { label: "Wellfound Profile", icon: "wellfound" },
  facebook: { label: "Facebook Profile", icon: "facebook" },
  tiktok: { label: "TikTok Profile", icon: "tiktok" },
  instagram: { label: "Instagram Profile", icon: "instagram" },
};

function OsintPlatformIcon({
  kind,
}: {
  kind: (typeof OSINT_PROFILE_META)[B2BSocialPlatform]["icon"];
}) {
  switch (kind) {
    case "linkedin":
      return <Linkedin className="h-3.5 w-3.5" />;
    case "x":
      return (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case "github":
      return <Code2 className="h-3.5 w-3.5" />;
    case "crunchbase":
      return <Building2 className="h-3.5 w-3.5" />;
    case "wellfound":
      return <Briefcase className="h-3.5 w-3.5" />;
    case "facebook":
      return <Share2 className="h-3.5 w-3.5" />;
    case "tiktok":
      return <Radio className="h-3.5 w-3.5" />;
    case "instagram":
      return <AtSign className="h-3.5 w-3.5" />;
  }
}

function HowToContact({
  lead,
  onRefreshed,
  onOsintUpdated,
}: {
  lead: Lead;
  onRefreshed: () => void;
  onOsintUpdated: (contacts: OsintStructuredContacts, checked: boolean) => void;
}) {
  const refind = useServerFn(reenrichContacts);
  const [busy, setBusy] = useState(false);
  const [osintBusy, setOsintBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await refind({ data: { lead_ids: [lead.id] } });
      toast.success(r.found ? "Contact details updated" : "No new contact details found");
      onRefreshed();
    } catch {
      toast.error("Could not search for contacts");
    } finally {
      setBusy(false);
    }
  }

  async function runOsintSearch() {
    setOsintBusy(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("Session expired — please sign in again.");
        return;
      }

      const res = await fetch(`/api/leads/${lead.id}/find-contact`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const payload = (await res.json()) as {
        ok?: boolean;
        osint_checked?: boolean;
        emails?: string[];
        social_profiles?: Partial<Record<B2BSocialPlatform, string>>;
        other_contacts?: string[];
        osint_contacts?: unknown;
        error?: string;
      };

      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "OSINT contact search failed");
      }

      const structured = normalizeStoredOsintContacts(
        payload.osint_contacts ?? {
          emails: payload.emails ?? [],
          social_profiles: payload.social_profiles ?? {},
          other_contacts: payload.other_contacts ?? [],
        },
      );
      const totalFound =
        structured.emails.length +
        Object.keys(structured.social_profiles).length +
        structured.other_contacts.length;

      onOsintUpdated(structured, Boolean(payload.osint_checked ?? true));
      toast.success(
        totalFound > 0 ? `Found ${totalFound} B2B contact(s)` : "No additional contacts found.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not run open-web search");
    } finally {
      setOsintBusy(false);
    }
  }

  const profile = contactAction(lead.linkedin_url ?? lead.reviewer_profile_url, lead.source_url);
  const showOsint = isOsintEligiblePlatform(lead.source_platform);
  const osintData = normalizeStoredOsintContacts(lead.osint_contacts);
  const osintProfileEntries = (
    Object.entries(osintData.social_profiles) as Array<[B2BSocialPlatform, string]>
  ).filter(([, url]) => Boolean(url));
  const hasAnyOsint =
    osintData.emails.length > 0 ||
    osintProfileEntries.length > 0 ||
    osintData.other_contacts.length > 0;
  const osintChecked = Boolean(lead.osint_checked);

  return (
    <div className="rounded-lg border p-4 text-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          How to contact
        </h3>
        <Button size="sm" variant="ghost" onClick={run} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}Re-find contacts
        </Button>
      </div>
      <ul className="space-y-2">
        {lead.email && (
          <li className="flex flex-wrap items-center gap-2">
            <Mail className="h-4 w-4 text-primary" />
            <a className="font-medium text-primary underline" href={`mailto:${lead.email}`}>
              {lead.email}
            </a>
            <span className="text-xs text-muted-foreground">
              {EMAIL_SOURCE[lead.email_status ?? ""] ?? "best guess from common formats"}
            </span>
          </li>
        )}
        {profile && (
          <li className="flex items-center gap-2">
            {profile.kind === "linkedin" ? (
              <Linkedin className="h-4 w-4 text-primary" />
            ) : (
              <UserRound className="h-4 w-4 text-primary" />
            )}
            <a
              className="text-primary underline"
              href={profile.url}
              target="_blank"
              rel="noreferrer"
            >
              {profile.kind === "linkedin"
                ? "LinkedIn profile"
                : `${platformLabel(lead.source_platform)} profile`}
            </a>
          </li>
        )}
        {(lead.job_title || lead.company) && (
          <li className="text-muted-foreground">
            {[lead.job_title, lead.company].filter(Boolean).join(" at ")}
            {lead.company_domain && ` (${lead.company_domain})`}
          </li>
        )}
        <li className="flex items-center gap-2">
          <ExternalLink className="h-4 w-4 text-primary" />
          <a
            className="text-primary underline"
            href={lead.source_url}
            target="_blank"
            rel="noreferrer"
          >
            Reply on {platformLabel(lead.source_platform)} (original post)
          </a>
        </li>
      </ul>

      {showOsint && (
        <div className="mt-4 border-t pt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={runOsintSearch}
            disabled={osintBusy}
            className="w-full sm:w-auto"
          >
            {osintBusy ? <Loader2 className="animate-spin" /> : <Globe />}
            {osintBusy ? "Searching public web..." : "Try To Find Another Contact"}
          </Button>
          <p className="mt-1.5 text-xs text-muted-foreground">
            ⚠️ Automated open-web search. Accuracy is not guaranteed.
          </p>

          {osintData.emails.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Verified Emails
              </div>
              {osintData.emails.map((email) => (
                <div
                  key={email}
                  className="flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2"
                >
                  <a
                    className="flex min-w-0 items-center gap-2 truncate font-medium text-primary underline"
                    href={`mailto:${email}`}
                  >
                    <Mail className="h-4 w-4 shrink-0" />
                    <span className="truncate">{email}</span>
                  </a>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-7 shrink-0 px-2.5 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(email);
                      toast.success("Email copied");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </Button>
                </div>
              ))}
            </div>
          )}

          {osintProfileEntries.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                B2B Profiles
              </div>
              <div className="flex flex-wrap gap-2">
                {osintProfileEntries.map(([platform, url]) => {
                  const meta = OSINT_PROFILE_META[platform];
                  return (
                    <Button key={platform} asChild size="sm" variant="secondary">
                      <a href={url} target="_blank" rel="noreferrer">
                        <OsintPlatformIcon kind={meta.icon} />
                        {meta.label}
                      </a>
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {osintData.other_contacts.length > 0 && (
            <div className="mt-3 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Phone Contacts
              </div>
              {osintData.other_contacts.map((phone) => (
                <div
                  key={phone}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5"
                >
                  <a
                    className="flex items-center gap-2 font-medium text-primary underline"
                    href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    {phone}
                  </a>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(phone);
                      toast.success("Phone copied");
                    }}
                  >
                    <Copy className="h-3 w-3" />
                    Copy
                  </Button>
                </div>
              ))}
            </div>
          )}

          {osintChecked && !hasAnyOsint && !osintBusy && (
            <p className="mt-3 text-xs text-muted-foreground">No additional contacts found.</p>
          )}
        </div>
      )}
    </div>
  );
}

function LeadsPage() {
  const { data: leads } = useSuspenseQuery(leadsQuery);
  const qc = useQueryClient();
  const [platform, setPlatform] = useState("all");
  const [status, setStatus] = useState("active");
  const [minScore, setMinScore] = useState("1");
  const [open, setOpen] = useState<Lead | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Lead | null>(null);
  const [deleting, setDeleting] = useState(false);

  const rows = useMemo(
    () =>
      leads.filter(
        (l) =>
          (platform === "all" || l.source_platform === platform) &&
          (status === "all" ||
            (status === "active" ? l.status !== "Archived" : l.status === status)) &&
          (Number.isFinite(l.sentiment_score) ? l.sentiment_score : 1) >= Number(minScore),
      ),
    [leads, platform, status, minScore],
  );

  async function setLeadStatus(l: Lead, s: (typeof STATUSES)[number]) {
    const { error } = await supabase.from("leads").update({ status: s }).eq("id", l.id);
    if (error) {
      toast.error("Could not update status");
      return;
    }
    setOpen({ ...l, status: s });
    qc.invalidateQueries({ queryKey: ["leads"] });
  }

  async function confirmDeleteLead() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        toast.error("Session expired — please sign in again.");
        return;
      }

      const res = await fetch(`/api/leads/${deleteTarget.id}`, {
        method: "DELETE",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || "Failed to delete lead");
      }

      if (open?.id === deleteTarget.id) {
        setOpen(null);
      }
      setDeleteTarget(null);
      toast.success("Lead deleted");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["leads"] }),
        qc.invalidateQueries({ queryKey: ["stats"] }),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete lead");
    } finally {
      setDeleting(false);
    }
  }

  function exportCsv() {
    if (rows.length === 0) {
      toast.info("No leads match the current filters to export.");
      return;
    }
    const csv = leadsToCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `churnhound-leads-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} lead${rows.length === 1 ? "" : "s"} to CSV`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground">
            People unhappy with your competitors, with the best way to reach each one.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          className="whitespace-nowrap shrink-0"
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap">
        <Select value={platform} onValueChange={setPlatform}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            {PLATFORMS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Not archived</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={minScore} onValueChange={setMinScore}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["1", "3", "5", "7", "9"].map((s) => (
              <SelectItem key={s} value={s}>
                {s === "1" ? "All scores (1+)" : `Score ${s}+`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-3 md:hidden">
        {rows.length === 0 && (
          <p className="glass p-6 text-center text-sm text-muted-foreground">
            No leads match these filters.
          </p>
        )}
        {rows.map((l) => (
          <div
            key={l.id}
            role="button"
            tabIndex={0}
            onClick={() => setOpen(l)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setOpen(l);
            }}
            className="glass block w-full cursor-pointer p-4 text-left"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold">{l.reviewer_name ?? "Unknown"}</div>
                <div className="text-xs text-muted-foreground">
                  {l.competitor_name} · {platformLabel(l.source_platform)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ScoreBadge score={l.sentiment_score} />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label="Delete lead"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(l);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <p className="mt-2 text-sm">{l.extracted_complaint}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {l.email && (
                <span className="inline-flex items-center gap-1 text-primary">
                  <Mail className="h-3 w-3" />
                  Email
                </span>
              )}
              {l.linkedin_url && (
                <span className="inline-flex items-center gap-1 text-primary">
                  <Linkedin className="h-3 w-3" />
                  LinkedIn
                </span>
              )}
              {!l.email && !l.linkedin_url && (
                <span className="inline-flex items-center gap-1">
                  <Radio className="h-3 w-3" />
                  Reply on {platformLabel(l.source_platform)}
                </span>
              )}
              <span>· {l.status}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="glass hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b">
              {[
                "Reviewer",
                "Company",
                "Competitor",
                "Platform",
                "Score",
                "Complaint",
                "Status",
                "Contact",
                "",
              ].map((h, i) => (
                <th key={h || `actions-${i}`} className="px-4 py-3 font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                  No leads match these filters.
                </td>
              </tr>
            )}
            {rows.map((l) => (
              <tr
                key={l.id}
                onClick={() => setOpen(l)}
                className="cursor-pointer border-b transition-colors last:border-0 hover:bg-secondary/50"
              >
                <td className="px-4 py-3">
                  <div className="font-bold">{l.reviewer_name ?? "—"}</div>
                  {l.lead_type === "social_signal" && (
                    <span className="inline-flex items-center gap-1 text-xs text-indigo">
                      <Radio className="h-3 w-3" />
                      Social Signal
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {[l.job_title, l.company].filter(Boolean).join(" · ") || "—"}
                </td>
                <td className="px-4 py-3">{l.competitor_name}</td>
                <td className="px-4 py-3">{platformLabel(l.source_platform)}</td>
                <td className="px-4 py-3">
                  <ScoreBadge score={l.sentiment_score} />
                </td>
                <td className="px-4 py-3">{l.extracted_complaint}</td>
                <td className="px-4 py-3 text-muted-foreground">{l.status}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {l.email && (
                      <Button
                        asChild
                        size="sm"
                        variant="secondary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <a href={`mailto:${l.email}`}>
                          <Mail />
                          Email
                        </a>
                      </Button>
                    )}
                    <ContactButton lead={l} />
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    aria-label="Delete lead"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(l);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <ScoreBadge score={open.sentiment_score} />
                  {open.reviewer_name}
                </SheetTitle>
              </SheetHeader>
              <div className="space-y-6 px-4 pb-6">
                <p className="text-sm text-muted-foreground">
                  {open.competitor_name} · {platformLabel(open.source_platform)} ·{" "}
                  {new Date(open.date_scraped).toLocaleString()}
                </p>
                <div>
                  <h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                    Complaint
                  </h3>
                  <p className="font-bold">{open.extracted_complaint}</p>
                </div>
                <div>
                  <h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                    Full text
                  </h3>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{open.review_text}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Pitch angle
                  </h3>
                  <p>{open.suggested_pitch}</p>
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      navigator.clipboard.writeText(open.suggested_pitch ?? "");
                      toast.success("Pitch copied");
                    }}
                  >
                    <Copy />
                    Copy Pitch
                  </Button>
                </div>
                <PitchMessage
                  lead={open}
                  onSaved={(m) => {
                    setOpen({ ...open, pitch_message: m });
                    qc.invalidateQueries({ queryKey: ["leads"] });
                  }}
                />
                <HowToContact
                  lead={open}
                  onRefreshed={async () => {
                    await qc.invalidateQueries({ queryKey: ["leads"] });
                    const fresh = qc
                      .getQueryData<Lead[]>(leadsQuery.queryKey)
                      ?.find((x) => x.id === open.id);
                    if (fresh) setOpen(fresh);
                  }}
                  onOsintUpdated={(contacts, checked) => {
                    setOpen({
                      ...open,
                      osint_contacts: contacts,
                      osint_checked: checked,
                    });
                    void qc.invalidateQueries({ queryKey: ["leads"] });
                  }}
                />
                <div>
                  <h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">
                    Status
                  </h3>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex gap-2">
                      {STATUSES.map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={open.status === s ? "default" : "outline"}
                          onClick={() => setLeadStatus(open, s)}
                        >
                          {s}
                        </Button>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setDeleteTarget(open)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete Lead
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(isOpen) => !isOpen && !deleting && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure you want to delete this lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the lead for{" "}
              <span className="font-medium text-foreground">
                {deleteTarget?.reviewer_name ?? "this reviewer"}
              </span>{" "}
              ({deleteTarget?.competitor_name}). This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDeleteLead();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PitchMessage({ lead, onSaved }: { lead: Lead; onSaved: (m: string) => void }) {
  const gen = useServerFn(generatePitchMessage);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      const r = await gen({ data: { lead_id: lead.id } });
      if (r.error) toast.error(r.error);
      else onSaved(r.message);
    } catch {
      toast.error("Could not write a message");
    } finally {
      setBusy(false);
    }
  }
  const label = lead.email ? "email" : lead.linkedin_url ? "LinkedIn note" : "reply";
  return (
    <div className="rounded-lg border p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Personalised {label}
      </h3>
      {lead.pitch_message && (
        <p className="mb-3 whitespace-pre-wrap text-sm">{lead.pitch_message}</p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={run} disabled={busy}>
          {busy ? <Loader2 className="animate-spin" /> : <Wand2 />}
          {lead.pitch_message ? "Regenerate" : "Generate message"}
        </Button>
        {lead.pitch_message && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(lead.pitch_message ?? "");
              toast.success("Message copied");
            }}
          >
            <Copy />
            Copy
          </Button>
        )}
      </div>
    </div>
  );
}

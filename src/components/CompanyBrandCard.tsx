import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Building2, Loader2, Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCompanyProfile, saveCompanyProfile } from "@/lib/leads.functions";

export function CompanyBrandCard() {
  const qc = useQueryClient();
  const fetchProfile = useServerFn(getCompanyProfile);
  const saveProfile = useServerFn(saveCompanyProfile);

  const q = useQuery({
    queryKey: ["company_profile"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: () => fetchProfile(),
  });

  const [companyName, setCompanyName] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");

  useEffect(() => {
    if (!q.data) return;
    setCompanyName(q.data.company_name ?? "");
    setCompanyUrl(q.data.company_url ?? "");
  }, [q.data]);

  const mutation = useMutation({
    mutationFn: (payload: { company_name: string; company_url: string }) =>
      saveProfile({ data: payload }),
    onSuccess: async (saved) => {
      qc.setQueryData(["company_profile"], saved);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["company_profile"] }),
        qc.invalidateQueries({ queryKey: ["brand_listening"] }),
        qc.invalidateQueries({ queryKey: ["ai_brand_insights"] }),
        qc.invalidateQueries({ queryKey: ["brand_recommendations"] }),
      ]);
      toast.success("Company brand saved");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not save company brand");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nameTrimmed = companyName.trim();
    const urlTrimmed = companyUrl.trim();
    if (!nameTrimmed && !urlTrimmed) {
      toast.error("Enter your brand name or company website");
      return;
    }
    mutation.mutate({
      company_name: nameTrimmed,
      company_url: urlTrimmed,
    });
  }

  const configured = Boolean(q.data?.company_name || q.data?.company_url);

  return (
    <form onSubmit={handleSubmit} className="glass space-y-3 p-5 text-left">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 font-bold">
            <Building2 className="h-4 w-4 text-primary" />
            <span>Your company &amp; brand</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Saved here for Brand Listening (tracking mentions of your own brand) and AI competitor
            detection.
          </p>
        </div>
        {configured && (
          <Button asChild size="sm" variant="ghost" className="gap-1.5 text-primary">
            <Link to="/brand-listening">
              <Megaphone className="h-3.5 w-3.5" />
              Brand Listening
            </Link>
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <Input
          aria-label="Your brand or company name"
          placeholder="Your brand name (e.g. Acme)"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          disabled={q.isLoading || mutation.isPending}
          maxLength={200}
          className="md:w-64"
        />
        <Input
          aria-label="Your company website"
          placeholder="yourcompany.com"
          value={companyUrl}
          onChange={(e) => setCompanyUrl(e.target.value)}
          disabled={q.isLoading || mutation.isPending}
          maxLength={300}
          className="flex-1"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={
            q.isLoading || mutation.isPending || (!companyName.trim() && !companyUrl.trim())
          }
          className="md:w-28"
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            "Save brand"
          )}
        </Button>
      </div>
    </form>
  );
}

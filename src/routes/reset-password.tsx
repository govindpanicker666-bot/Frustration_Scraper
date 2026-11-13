import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Churnhound" },
      { name: "description", content: "Choose a new password for your Churnhound account." },
      { property: "og:title", content: "Set a new password — Churnhound" },
      { property: "og:description", content: "Choose a new password for your Churnhound account." },
    ],
  }),
  component: ResetPage,
});

function ResetPage() {
  const [pw, setPw] = useState("");
  const navigate = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated");
    navigate({ to: "/dashboard" });
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-5 p-8">
        <h1 className="text-2xl font-bold">Set a new password</h1>
        <Input
          type="password"
          minLength={6}
          required
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="New password"
        />
        <Button type="submit" variant="hero" className="w-full">
          Update password
        </Button>
      </form>
    </main>
  );
}

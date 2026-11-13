import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Churnhound" },
      { name: "description", content: "Sign in or create your Churnhound account." },
      { property: "og:title", content: "Sign in — Churnhound" },
      { property: "og:description", content: "Sign in or create your Churnhound account." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      } else if (mode === "up") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/dashboard" },
        });
        if (error) throw error;
        if (data.session) navigate({ to: "/onboarding" });
        else toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) throw error;
        toast.success("Password reset link sent.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-5 p-8">
        <Link to="/" className="font-display text-xl font-semibold">
          Churnhound
        </Link>
        <h1 className="text-2xl font-bold">
          {mode === "in"
            ? "Welcome back"
            : mode === "up"
              ? "Create your account"
              : "Reset password"}
        </h1>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {mode !== "forgot" && (
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        )}
        <Button type="submit" variant="hero" className="w-full" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "in"
              ? "Sign in"
              : mode === "up"
                ? "Sign up"
                : "Send reset link"}
        </Button>
        <div className="flex justify-between text-sm text-muted-foreground">
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => setMode(mode === "up" ? "in" : "up")}
          >
            {mode === "up" ? "Have an account? Sign in" : "New here? Sign up"}
          </button>
          {mode === "in" && (
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setMode("forgot")}
            >
              Forgot?
            </button>
          )}
        </div>
      </form>
    </main>
  );
}

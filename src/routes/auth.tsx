import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Flame, Loader2, Radar, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/integrations/supabase/constants";
import { syncMyFullName, syncPendingSignupName } from "@/lib/leads.functions";
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

type SocialProviderButton = "google" | "linkedin" | "facebook";

interface ProviderAvailability {
  loaded: boolean;
  google: boolean;
  linkedin_oidc: boolean;
  linkedin: boolean;
  facebook: boolean;
}

const PROVIDER_LABELS: Record<SocialProviderButton, string> = {
  google: "Google",
  linkedin: "LinkedIn",
  facebook: "Facebook",
};

const VALUE_PROPS = [
  {
    icon: Radar,
    title: "Multi-channel complaint radar",
    description:
      "Continuously tracks Reddit, LinkedIn, G2, Hacker News, and X for buyers frustrated with competitors.",
  },
  {
    icon: Flame,
    title: "AI frustration & intent scoring",
    description:
      "Gemini analyzes every mention 1–10 and highlights real decision-makers actively looking to switch.",
  },
  {
    icon: UserCheck,
    title: "Direct outreach intelligence",
    description:
      "Surfaces LinkedIn profiles, verified emails, and personalized pitch angles ready for immediate outreach.",
  },
] as const;

function GoogleIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#0A66C2"
        d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
      />
    </svg>
  );
}

function FacebookIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#1877F2"
        d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 6.026 4.388 11.02 10.125 11.927v-8.437H7.078v-3.49h3.047V9.41c0-3.025 1.792-4.696 4.533-4.696 1.312 0 2.686.236 2.686.236v2.97h-1.513c-1.491 0-1.956.93-1.956 1.886v2.267h3.328l-.532 3.49h-2.796V24C19.612 23.093 24 18.099 24 12.073z"
      />
    </svg>
  );
}

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resendingConfirmation, setResendingConfirmation] = useState(false);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<SocialProviderButton | null>(null);
  const [providerNotice, setProviderNotice] = useState<string | null>(null);
  const [availability, setAvailability] = useState<ProviderAvailability>({
    loaded: false,
    google: true,
    linkedin_oidc: true,
    linkedin: false,
    facebook: true,
  });

  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const fullNameInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const saveAuthenticatedFullName = useServerFn(syncMyFullName);
  const savePendingFullName = useServerFn(syncPendingSignupName);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);

    fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/settings`, {
      signal: controller.signal,
      headers: { apikey: SUPABASE_ANON_KEY },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { external?: Record<string, boolean> } | null) => {
        if (!active || !data?.external) return;
        const ext = data.external;
        setAvailability({
          loaded: true,
          google: Boolean(ext["google"]),
          linkedin_oidc: Boolean(ext["linkedin_oidc"]),
          linkedin: Boolean(ext["linkedin"]),
          facebook: Boolean(ext["facebook"]),
        });
      })
      .catch(() => {
        /* fallback gracefully if offline */
      })
      .finally(() => {
        window.clearTimeout(timer);
      });

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, []);

  function isButtonEnabled(kind: SocialProviderButton): boolean {
    if (!availability.loaded) return true;
    if (kind === "google") return availability.google;
    if (kind === "linkedin") return availability.linkedin_oidc || availability.linkedin;
    return availability.facebook;
  }

  function resolveSupabaseProvider(kind: SocialProviderButton): string {
    if (kind === "linkedin") {
      return availability.linkedin_oidc ? "linkedin_oidc" : "linkedin";
    }
    return kind;
  }

  function focusEmailFallback() {
    if (mode === "up") {
      fullNameInputRef.current?.focus();
    } else {
      emailInputRef.current?.focus();
    }
  }

  async function handleOAuth(kind: SocialProviderButton) {
    const label = PROVIDER_LABELS[kind];
    setProviderNotice(null);

    if (availability.loaded && !isButtonEnabled(kind)) {
      const msg = `${label} sign-in is not yet enabled in your Supabase Auth settings (Authentication → Providers → ${label}). Please enable it with your OAuth Client ID & Secret, or use Email & Password below right now.`;
      setProviderNotice(msg);
      toast.error(`${label} OAuth is not configured in Supabase yet. Use Email & Password below.`);
      focusEmailFallback();
      return;
    }

    setOauthProvider(kind);
    try {
      const resolved = resolveSupabaseProvider(kind);
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: resolved as "google" | "linkedin_oidc" | "facebook",
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (!data?.url) {
        throw new Error(`${label} sign-in URL could not be generated.`);
      }

      if (window.top && window.top !== window.self) {
        try {
          window.top.location.href = data.url;
          return;
        } catch {
          /* cross-origin iframe fallback */
        }
      }
      window.location.assign(data.url);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Could not start social sign-in";
      const normalized = /not enabled|unsupported provider/i.test(raw)
        ? `${label} sign-in is not enabled in Supabase Authentication → Providers yet. Use Email & Password below or add ${label} OAuth credentials in Supabase.`
        : raw;
      setProviderNotice(normalized);
      toast.error(normalized);
      setOauthProvider(null);
      focusEmailFallback();
    }
  }

  async function handleResendConfirmation() {
    if (!email.trim()) {
      toast.error("Enter your email address first.");
      return;
    }
    setResendingConfirmation(true);
    try {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
        },
      });
      if (error) throw error;
      toast.success("Confirmation email sent! Check your inbox and spam folder.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resend confirmation email.");
    } finally {
      setResendingConfirmation(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setProviderNotice(null);
    setNeedsEmailConfirmation(false);
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          if (/email not confirmed/i.test(error.message)) {
            setNeedsEmailConfirmation(true);
          }
          throw error;
        }
        navigate({ to: "/dashboard" });
      } else if (mode === "up") {
        const trimmedName = fullName.trim();
        if (!trimmedName) {
          toast.error("Please enter your full name.");
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + "/dashboard",
            data: { full_name: trimmedName },
          },
        });
        if (error) throw error;

        if (Array.isArray(data.user?.identities) && data.user.identities.length === 0) {
          toast.error("An account with this email already exists. Please sign in instead.");
          setMode("in");
          return;
        }

        if (data.session) {
          await saveAuthenticatedFullName({ data: { full_name: trimmedName } }).catch(() => null);
          navigate({ to: "/onboarding" });
        } else {
          if (data.user?.id) {
            await savePendingFullName({
              data: { user_id: data.user.id, full_name: trimmedName },
            }).catch(() => null);
          }
          setNeedsEmailConfirmation(true);
          toast.success("Account created! Check your email inbox to confirm before signing in.");
        }
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

  const disabled = busy || oauthProvider !== null;
  const anySocialDisabled =
    availability.loaded &&
    (!isButtonEnabled("google") || !isButtonEnabled("linkedin") || !isButtonEnabled("facebook"));

  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-2">
      {/* Left Brand Value Proposition Panel */}
      <section className="hidden flex-col justify-between border-r border-border bg-card p-10 lg:flex xl:p-14">
        <Link to="/" className="inline-flex w-fit flex-col items-start">
          <span className="font-display text-xl font-semibold leading-none tracking-tight">
            Churnhound
          </span>
          <span className="mt-1.5 inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium leading-none tracking-wide text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
            Free Beta
          </span>
        </Link>

        <div className="my-auto max-w-lg space-y-8 py-12">
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Frustration-led pipeline
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-balance xl:text-4xl">
              Your competitors&apos; most vocal critics are your warmest leads.
            </h1>
            <p className="text-base leading-relaxed text-muted-foreground">
              Stop cold prospecting blind. Discover teams actively complaining about the tools you
              replace and reach out with context.
            </p>
          </div>

          <div className="divide-y divide-border border-y border-border">
            {VALUE_PROPS.map((item) => (
              <div key={item.title} className="flex items-start gap-3.5 py-4">
                <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="space-y-1">
                  <h2 className="text-sm font-semibold text-foreground">{item.title}</h2>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Churnhound · Built for B2B SaaS growth &amp; founder-led sales
        </p>
      </section>

      {/* Right Auth Form Panel */}
      <section className="flex flex-col items-center justify-center px-5 py-10 sm:px-10">
        <div className="mb-6 flex w-full max-w-md items-center justify-between lg:hidden">
          <Link to="/" className="inline-flex flex-col items-start">
            <span className="font-display text-xl font-semibold leading-none tracking-tight">
              Churnhound
            </span>
            <span className="mt-1 inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium leading-none tracking-wide text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
              Free Beta
            </span>
          </Link>
        </div>

        <div className="glass w-full max-w-md space-y-5 p-7 sm:p-8">
          <div className="space-y-1">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              {mode === "in"
                ? "Welcome back"
                : mode === "up"
                  ? "Create your account"
                  : "Reset password"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "in"
                ? "Sign in to check today's frustrated competitor leads."
                : mode === "up"
                  ? "Start tracking competitors for free during beta."
                  : "Enter your email and we will send you a reset link."}
            </p>
          </div>

          {providerNotice && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{providerNotice}</span>
            </div>
          )}

          {needsEmailConfirmation && (
            <div
              role="status"
              className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed text-foreground"
            >
              <p>
                Your account requires email confirmation before signing in. Check your inbox for the
                verification link.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={resendingConfirmation}
                onClick={() => void handleResendConfirmation()}
              >
                {resendingConfirmation ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Sending…
                  </>
                ) : (
                  "Resend confirmation email"
                )}
              </Button>
            </div>
          )}

          {mode !== "forgot" && (
            <>
              <div className="space-y-2.5">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full justify-center gap-2.5 font-medium"
                  disabled={disabled}
                  onClick={() => void handleOAuth("google")}
                >
                  {oauthProvider === "google" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <GoogleIcon />
                  )}
                  <span>Sign in with Google</span>
                  {availability.loaded && !isButtonEnabled("google") && (
                    <span className="ml-auto text-[11px] font-normal text-muted-foreground">
                      Not configured
                    </span>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full justify-center gap-2.5 font-medium"
                  disabled={disabled}
                  onClick={() => void handleOAuth("linkedin")}
                >
                  {oauthProvider === "linkedin" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <LinkedInIcon />
                  )}
                  <span>Sign in with LinkedIn</span>
                  {availability.loaded && !isButtonEnabled("linkedin") && (
                    <span className="ml-auto text-[11px] font-normal text-muted-foreground">
                      Not configured
                    </span>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full justify-center gap-2.5 font-medium"
                  disabled={disabled}
                  onClick={() => void handleOAuth("facebook")}
                >
                  {oauthProvider === "facebook" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FacebookIcon />
                  )}
                  <span>Sign in with Facebook</span>
                  {availability.loaded && !isButtonEnabled("facebook") && (
                    <span className="ml-auto text-[11px] font-normal text-muted-foreground">
                      Not configured
                    </span>
                  )}
                </Button>

                {anySocialDisabled && (
                  <p className="text-[11px] text-muted-foreground">
                    Email &amp; password sign-in is active now. Enable social providers in Supabase
                    Authentication → Providers to activate one-click OAuth.
                  </p>
                )}
              </div>

              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2.5 text-muted-foreground">
                    or continue with email
                  </span>
                </div>
              </div>
            </>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === "up" && (
              <div className="space-y-2">
                <Label htmlFor="full-name">Full Name</Label>
                <Input
                  ref={fullNameInputRef}
                  id="full-name"
                  type="text"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                  placeholder="Alex Morgan"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  disabled={disabled}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                ref={emailInputRef}
                id="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={disabled}
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
                  autoComplete={mode === "up" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={disabled}
                />
              </div>
            )}

            <Button type="submit" variant="hero" className="h-10 w-full" disabled={disabled}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Please wait…
                </>
              ) : mode === "in" ? (
                "Sign in"
              ) : mode === "up" ? (
                "Create account"
              ) : (
                "Send reset link"
              )}
            </Button>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm text-muted-foreground">
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => {
                setProviderNotice(null);
                setNeedsEmailConfirmation(false);
                setMode(mode === "up" ? "in" : "up");
              }}
            >
              {mode === "up" ? "Have an account? Sign in" : "New here? Sign up"}
            </button>
            {mode === "in" ? (
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => {
                  setProviderNotice(null);
                  setNeedsEmailConfirmation(false);
                  setMode("forgot");
                }}
              >
                Forgot?
              </button>
            ) : mode === "forgot" ? (
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => {
                  setProviderNotice(null);
                  setNeedsEmailConfirmation(false);
                  setMode("in");
                }}
              >
                Back to sign in
              </button>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}

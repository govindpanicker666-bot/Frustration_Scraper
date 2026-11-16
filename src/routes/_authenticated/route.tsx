import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  Bug,
  ChevronsUpDown,
  Crosshair,
  FileText,
  LayoutDashboard,
  LayoutTemplate,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
  MessageSquarePlus,
  Newspaper,
  Radar,
  Shield,
  Trash2,
  UserCircle,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { FeedbackDialog, type FeedbackType } from "@/components/FeedbackDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCurrentUser } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { deleteMyAccount, syncMyFullName } from "@/lib/leads.functions";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth" });
  },
  component: AppLayout,
});

function AppLayout() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const deleteAccountFn = useServerFn(deleteMyAccount);
  const syncFullNameFn = useServerFn(syncMyFullName);
  const syncedNameRef = useRef<string | null>(null);

  const [menu, setMenu] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("feedback");

  function openFeedback(kind: FeedbackType) {
    setFeedbackType(kind);
    setFeedbackOpen(true);
  }

  useEffect(() => {
    if (!me?.user.id || !me.fullName) return;
    const existingProfileName =
      me.profile && typeof me.profile.full_name === "string" ? me.profile.full_name.trim() : "";
    if (existingProfileName) return;

    const syncKey = `${me.user.id}:${me.fullName}`;
    if (syncedNameRef.current === syncKey) return;
    syncedNameRef.current = syncKey;

    void syncFullNameFn({ data: { full_name: me.fullName } }).catch(() => undefined);
  }, [me?.user.id, me?.fullName, me?.profile, syncFullNameFn]);

  const nav: ReadonlyArray<{
    to: string;
    label: string;
    icon: typeof LayoutDashboard;
    tourId?: string;
  }> = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/leads", label: "Leads", icon: Users },
    { to: "/insights", label: "Insights", icon: BarChart3, tourId: "nav-insights" },
    { to: "/brand-listening", label: "Brand Listening", icon: Megaphone },
    { to: "/ai-visibility", label: "AI Visibility", icon: Radar },
    { to: "/news", label: "Competitor News", icon: Newspaper },
    { to: "/onboarding", label: "Competitors", icon: Crosshair, tourId: "nav-competitors" },
    ...(me?.isAdmin
      ? [
          { to: "/admin", label: "Admin", icon: Shield },
          { to: "/blog-admin", label: "Blog", icon: FileText },
          { to: "/page-builder", label: "Page Builder", icon: LayoutTemplate },
        ]
      : []),
  ];

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  async function handleDeleteAccount() {
    setDeletingAccount(true);
    try {
      await deleteAccountFn();
      await qc.cancelQueries();
      qc.clear();
      if (typeof window !== "undefined") {
        window.sessionStorage.removeItem("churnhound_onboarding_schedule_prompt");
        window.sessionStorage.removeItem("churnhound_initial_scan_active");
      }
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
      setConfirmDeleteOpen(false);
      navigate({ to: "/auth", replace: true });
      toast.success("Account deleted successfully.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete account.");
    } finally {
      setDeletingAccount(false);
    }
  }

  const links = (onNav?: () => void, attachTour = false) =>
    nav.map((n) => (
      <Link
        key={n.to}
        to={n.to}
        onClick={onNav}
        data-tour={attachTour && n.tourId ? n.tourId : undefined}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
        activeProps={{ className: "bg-sidebar-accent font-medium text-foreground" }}
      >
        <n.icon className="h-4 w-4" />
        {n.label}
      </Link>
    ));

  const logo = (
    <div className="flex flex-col items-start">
      <span className="font-display text-lg font-semibold leading-none tracking-tight">
        Churnhound
      </span>
      <span className="mt-1 inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium leading-none tracking-wide text-emerald-700 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
        Free Beta
      </span>
    </div>
  );

  const displayName = me?.fullName || me?.user.email?.split("@")[0] || "Account";
  const emailText = me?.user.email ?? "";

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 flex-col border-r bg-sidebar p-4 md:flex">
        <div className="mb-6 flex items-start justify-between px-2">
          {logo}
          <ThemeToggle />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">{links(undefined, true)}</nav>
        <div data-tour="user-profile" className="border-t pt-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <UserCircle className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground">{displayName}</div>
                  {emailText && (
                    <div className="truncate text-[11px] text-muted-foreground">{emailText}</div>
                  )}
                </div>
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <div className="truncate text-xs font-semibold text-foreground">{displayName}</div>
                {emailText && (
                  <div className="truncate text-[11px] text-muted-foreground">{emailText}</div>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => openFeedback("feedback")}
                className="cursor-pointer"
              >
                <MessageSquarePlus className="h-4 w-4" />
                Give Feedback
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openFeedback("error")} className="cursor-pointer">
                <Bug className="h-4 w-4" />
                Report an Error
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void signOut()} className="cursor-pointer">
                <LogOut className="h-4 w-4" />
                Sign out
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => setConfirmDeleteOpen(true)}
                className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
                Delete Account
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 py-2.5 backdrop-blur md:hidden">
          {logo}
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              onClick={() => setMenu(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
        </header>
        <Sheet open={menu} onOpenChange={setMenu}>
          <SheetContent side="left" className="flex w-64 flex-col p-4">
            <SheetHeader className="p-0 pb-4 text-left">
              <SheetTitle>{logo}</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-1 flex-col gap-0.5">{links(() => setMenu(false))}</nav>
            <div className="mt-6 space-y-2 border-t pt-3">
              <div>
                <div className="truncate text-xs font-medium text-foreground">{displayName}</div>
                {emailText && (
                  <div className="truncate text-[11px] text-muted-foreground">{emailText}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  openFeedback("feedback");
                }}
                className="flex w-full items-center gap-2 rounded-md py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <MessageSquarePlus className="h-4 w-4" />
                Give Feedback
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  openFeedback("error");
                }}
                className="flex w-full items-center gap-2 rounded-md py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <Bug className="h-4 w-4" />
                Report an Error
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  void signOut();
                }}
                className="flex w-full items-center gap-2 rounded-md py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenu(false);
                  setConfirmDeleteOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-md py-1.5 text-sm text-destructive hover:opacity-80"
              >
                <Trash2 className="h-4 w-4" />
                Delete Account
              </button>
            </div>
          </SheetContent>
        </Sheet>
        <main className="mx-auto max-w-6xl p-4 sm:p-6 md:p-10">
          <Outlet />
        </main>
      </div>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(open) => !open && !deletingAccount && setConfirmDeleteOpen(false)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all of your data, including your tracked competitors,
              leads, brand listening history, and schedule settings. This action cannot be undone,
              though you can re-sign up with the same email address later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAccount}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingAccount}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteAccount();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAccount ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4" />
                  Delete Account
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <FeedbackDialog
        open={feedbackOpen}
        initialType={feedbackType}
        onOpenChange={setFeedbackOpen}
      />
    </div>
  );
}

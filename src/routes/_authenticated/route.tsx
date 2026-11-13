import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  BarChart3,
  FileText,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Menu,
  Shield,
  Users,
  Crosshair,
  Newspaper,
  LayoutTemplate,
} from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-auth";

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
  const nav = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/leads", label: "Leads", icon: Users },
    { to: "/insights", label: "Insights", icon: BarChart3 },
    { to: "/brand-listening", label: "Brand Listening", icon: Megaphone },
    { to: "/news", label: "Competitor News", icon: Newspaper },
    { to: "/onboarding", label: "Competitors", icon: Crosshair },
    ...(me?.isAdmin
      ? [
          { to: "/admin", label: "Admin", icon: Shield },
          { to: "/blog-admin", label: "Blog", icon: FileText },
          { to: "/page-builder", label: "Page Builder", icon: LayoutTemplate },
        ]
      : []),
  ] as const;

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const [menu, setMenu] = useState(false);
  const links = (onNav?: () => void) =>
    nav.map((n) => (
      <Link
        key={n.to}
        to={n.to}
        onClick={onNav}
        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
        activeProps={{ className: "bg-sidebar-accent font-medium text-foreground" }}
      >
        <n.icon className="h-4 w-4" />
        {n.label}
      </Link>
    ));
  const logo = (
    <span className="font-display text-lg font-semibold tracking-tight">Churnhound</span>
  );

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 flex-col border-r bg-sidebar p-4 md:flex">
        <div className="mb-6 flex items-center justify-between px-2">
          {logo}
          <ThemeToggle />
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">{links()}</nav>
        <div className="truncate px-2 text-xs text-muted-foreground">{me?.user.email}</div>
        <button
          onClick={signOut}
          className="mt-2 flex items-center gap-2 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/95 px-4 py-2 backdrop-blur md:hidden">
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
          <SheetContent side="left" className="w-64 p-4">
            <SheetHeader className="p-0 pb-4">
              <SheetTitle>{logo}</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-0.5">{links(() => setMenu(false))}</nav>
            <div className="mt-6 truncate text-xs text-muted-foreground">{me?.user.email}</div>
            <button
              onClick={signOut}
              className="mt-2 flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </SheetContent>
        </Sheet>
        <main className="mx-auto max-w-6xl p-4 sm:p-6 md:p-10">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

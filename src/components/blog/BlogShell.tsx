import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";

export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-display text-lg font-semibold tracking-tight">
            Churnhound
          </Link>
          <nav className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link to="/blog">Blog</Link>
            </Button>
            <ThemeToggle />
            <Button asChild size="sm">
              <Link to="/auth">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10">{children}</main>
      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Churnhound
      </footer>
    </div>
  );
}

export const fmtDate = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "";

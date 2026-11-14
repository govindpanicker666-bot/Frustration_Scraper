import { createFileRoute, Link } from "@tanstack/react-router";
import { Flame, Radar, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Churnhound — turn competitor frustration into pipeline" },
      {
        name: "description",
        content:
          "Churnhound watches G2, Reddit, Hacker News and the App Store for people fed up with your competitors, scores their frustration with AI and writes the pitch.",
      },
      { property: "og:title", content: "Churnhound — turn competitor frustration into pipeline" },
      {
        property: "og:description",
        content: "AI-scored leads from people publicly complaining about your competitors.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: Radar,
    title: "Listens everywhere",
    body: "G2, Reddit, Hacker News and App Store reviews from the last 48 hours.",
  },
  {
    icon: Flame,
    title: "Scores frustration",
    body: "Gemini rates every complaint 1–10. Only the 8+ make your list.",
  },
  {
    icon: Target,
    title: "Finds the person",
    body: "Looks up reviewers on LinkedIn so you can reach out directly.",
  },
  {
    icon: Sparkles,
    title: "Writes the pitch",
    body: "A one-line angle tailored to exactly what made them angry.",
  },
];

function Landing() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <nav className="flex items-center justify-between">
        <span className="font-display text-xl font-semibold">Churnhound</span>
        <div className="flex items-center gap-1">
          <Button asChild variant="ghost">
            <Link to="/blog">Blog</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/auth">Sign in</Link>
          </Button>
        </div>
      </nav>
      <section className="py-24 text-center animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both">
        <p className="mb-4 text-sm uppercase tracking-[0.25em] text-primary">
          Frustration-led growth
        </p>
        <h1 className="mx-auto max-w-3xl text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
          Your competitors' angriest customers are{" "}
          <span className="text-gradient">your next deals.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
          We find people publicly fed up with the tools you compete against, score how ready they
          are to switch, and hand you the pitch.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <Button asChild variant="hero" size="lg">
            <Link to="/auth">Start finding leads</Link>
          </Button>
        </div>
      </section>
      <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f, i) => (
          <div
            key={f.title}
            style={{ animationDelay: `${200 + i * 80}ms` }}
            className="glass p-6 animate-in fade-in slide-in-from-bottom-4 duration-500 fill-mode-both"
          >
            <f.icon className="mb-4 h-6 w-6 text-primary" />
            <h3 className="font-bold">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}

import { cn } from "@/lib/utils";
export function ScoreBadge({ score }: { score: number | null | undefined }) {
  const valid = typeof score === "number" && Number.isFinite(score) ? score : null;
  return (
    <span
      className={cn(
        "inline-flex h-7 w-9 items-center justify-center rounded-md text-sm font-bold",
        valid !== null && valid >= 9
          ? "bg-destructive/20 text-destructive"
          : valid !== null && valid >= 8
            ? "bg-warning/20 text-warning"
            : "bg-muted text-muted-foreground",
      )}
    >
      {valid ?? "-"}
    </span>
  );
}

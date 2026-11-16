import { ArrowLeft, ArrowRight, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

export interface TourStep {
  selector: string;
  title: string;
  description: string;
}

const DEFAULT_STEPS: TourStep[] = [
  {
    selector: '[data-tour="frustrated-leads"]',
    title: "Frustrated Leads",
    description:
      "These are real people publicly complaining about your competitors. Click any lead row — or open View all for your full Leads inbox — to see their complaint, contact info, and draft an outreach pitch.",
  },
  {
    selector: '[data-tour="nav-insights"]',
    title: "Insights & AI Recommendations",
    description:
      "Visit the Insights tab to view top complaint patterns, frustration trends, and AI-generated recommendations tailored to your market.",
  },
  {
    selector: '[data-tour="nav-competitors"]',
    title: "Competitors",
    description:
      "Need to watch more rivals? Open the Competitors tab anytime to detect, add, or remove competitors.",
  },
  {
    selector: '[data-tour="user-profile"]',
    title: "User Profile & Settings",
    description:
      "Manage your account session here, and adjust your company brand or daily auto-scan schedule right from your workspace.",
  },
];

interface OnboardingTourProps {
  open: boolean;
  onFinish: () => void;
  steps?: TourStep[];
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function OnboardingTour({ open, onFinish, steps = DEFAULT_STEPS }: OnboardingTourProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<SpotlightRect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const currentStep = steps[stepIdx] ?? steps[0];

  const measureTarget = useCallback(() => {
    if (!open || !currentStep || typeof window === "undefined") {
      setRect(null);
      return;
    }

    const el = document.querySelector(currentStep.selector);
    if (!(el instanceof HTMLElement)) {
      setRect(null);
      return;
    }

    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      setRect(null);
      return;
    }

    const padding = 8;
    setRect({
      top: Math.max(8, r.top - padding),
      left: Math.max(8, r.left - padding),
      width: Math.min(window.innerWidth - 16, r.width + padding * 2),
      height: r.height + padding * 2,
    });
  }, [open, currentStep]);

  useEffect(() => {
    if (!open || !currentStep || typeof window === "undefined") return;

    const el = document.querySelector(currentStep.selector);
    if (el instanceof HTMLElement && el.offsetParent !== null) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    }

    const timer = window.setTimeout(measureTarget, 80);
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
    };
  }, [open, currentStep, measureTarget]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onFinish();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onFinish]);

  if (!open || !mounted || !currentStep) return null;

  const isLast = stepIdx === steps.length - 1;

  // Compute safe popover position that never overflows the viewport.
  let cardStyle: React.CSSProperties;
  const cardWidth = Math.min(340, window.innerWidth - 32);

  if (rect) {
    const isSidebarTarget = rect.left < 240 && window.innerWidth >= 768;
    if (isSidebarTarget) {
      const topPos = Math.max(16, Math.min(rect.top, window.innerHeight - 250));
      cardStyle = {
        position: "fixed",
        top: topPos,
        left: Math.min(rect.left + rect.width + 16, window.innerWidth - cardWidth - 16),
        width: cardWidth,
      };
    } else {
      const placeAbove = rect.top > 240;
      const topPos = placeAbove
        ? Math.max(16, rect.top - 220)
        : Math.min(window.innerHeight - 230, rect.top + rect.height + 16);
      const leftPos = Math.max(16, Math.min(rect.left, window.innerWidth - cardWidth - 16));
      cardStyle = {
        position: "fixed",
        top: topPos,
        left: leftPos,
        width: cardWidth,
      };
    }
  } else {
    cardStyle = {
      position: "fixed",
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
      width: cardWidth,
    };
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Product walkthrough"
    >
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-lg border-2 border-primary transition-all duration-200"
          style={{
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.62)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-slate-950/65 backdrop-blur-[1px]" />
      )}

      <div
        style={cardStyle}
        className="z-50 rounded-xl border border-slate-200 bg-card p-5 text-card-foreground shadow-2xl dark:border-border"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            <span>
              Step {stepIdx + 1} of {steps.length}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onFinish}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Skip Tour
          </Button>
        </div>

        <h3 className="text-base font-semibold tracking-tight">{currentStep.title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {currentStep.description}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onFinish}
            className="h-8 px-2 text-xs text-muted-foreground"
          >
            Skip Tour
          </Button>
          <div className="flex items-center gap-2">
            {stepIdx > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (isLast) {
                  onFinish();
                } else {
                  setStepIdx((i) => Math.min(steps.length - 1, i + 1));
                }
              }}
            >
              {isLast ? (
                "Finish Tour"
              ) : (
                <>
                  Next
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

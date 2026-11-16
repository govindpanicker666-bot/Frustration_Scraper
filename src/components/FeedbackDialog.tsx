import { useServerFn } from "@tanstack/react-start";
import { Bug, Loader2, MessageSquarePlus, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitUserFeedback } from "@/lib/leads.functions";
import { cn } from "@/lib/utils";

export type FeedbackType = "feedback" | "error";

interface FeedbackDialogProps {
  open: boolean;
  initialType: FeedbackType;
  onOpenChange: (open: boolean) => void;
}

export function FeedbackDialog({ open, initialType, onOpenChange }: FeedbackDialogProps) {
  const submitFeedbackFn = useServerFn(submitUserFeedback);
  const [type, setType] = useState<FeedbackType>(initialType);
  const [subject, setSubject] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setType(initialType);
    }
  }, [open, initialType]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedSubject = subject.trim();
    const trimmedDetails = details.trim();
    if (trimmedSubject.length < 2) {
      toast.error("Please add a short subject.");
      return;
    }
    if (trimmedDetails.length < 5) {
      toast.error("Please describe your feedback or issue in a few words.");
      return;
    }

    setSubmitting(true);
    try {
      const pagePath = typeof window !== "undefined" ? window.location.pathname : "/";
      await submitFeedbackFn({
        data: {
          type,
          subject: trimmedSubject,
          details: trimmedDetails,
          pagePath,
        },
      });
      toast.success(
        type === "error"
          ? "Error report submitted. Thanks for helping us improve!"
          : "Feedback sent. Thanks for sharing!",
      );
      setSubject("");
      setDetails("");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send your message.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{type === "error" ? "Report an error" : "Share feedback"}</DialogTitle>
          <DialogDescription>
            {type === "error"
              ? "Tell us what broke or looked wrong and which page you were on."
              : "Suggest an improvement, request a source, or tell us how Churnhound feels."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/40 p-1">
            <button
              type="button"
              disabled={submitting}
              onClick={() => setType("feedback")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                type === "feedback"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Give Feedback
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => setType("error")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                type === "error"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Bug className="h-3.5 w-3.5" />
              Report an Error
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-subject">Subject</Label>
            <Input
              id="feedback-subject"
              required
              minLength={2}
              maxLength={120}
              disabled={submitting}
              placeholder={
                type === "error"
                  ? "e.g. Competitor scan stalled on step 2"
                  : "e.g. Add Slack alerts for high-score leads"
              }
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="feedback-details">Details</Label>
            <Textarea
              id="feedback-details"
              required
              minLength={5}
              maxLength={2000}
              rows={4}
              disabled={submitting}
              placeholder={
                type === "error"
                  ? "What happened, what did you expect, and any steps to reproduce?"
                  : "Share as much context as you'd like..."
              }
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  {type === "error" ? "Submit Report" : "Send Feedback"}
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

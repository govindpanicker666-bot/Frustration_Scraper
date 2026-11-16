import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Loader2 } from "lucide-react";
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { formatLocalHour, formatUtcHour } from "@/lib/pipeline";

interface ScheduleOnboardingModalProps {
  open: boolean;
  onClose: () => void;
}

export function ScheduleOnboardingModal({ open, onClose }: ScheduleOnboardingModalProps) {
  const qc = useQueryClient();
  const [runHour, setRunHour] = useState<number>(6);

  const saveMutation = useMutation({
    mutationFn: async (hour: number) => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("Please sign in again.");

      const { error } = await supabase.from("user_scrape_settings").upsert(
        {
          user_id: user.id,
          enabled: true,
          run_hour: hour,
          pause_reason: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["scrape_settings"] });
      toast.success("Daily schedule saved");
      onClose();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not save schedule");
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saveMutation.isPending) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Clock className="h-5 w-5" />
          </div>
          <DialogTitle>Your initial scan is running!</DialogTitle>
          <DialogDescription>
            When would you like us to scan for new leads automatically every day?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          <label className="text-xs font-medium text-muted-foreground">Daily scan start time</label>
          <Select
            value={String(runHour)}
            onValueChange={(v) => setRunHour(Number(v))}
            disabled={saveMutation.isPending}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, h) => (
                <SelectItem key={h} value={String(h)}>
                  Start {formatUtcHour(h)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Runs daily at{" "}
            <span className="font-medium text-foreground">{formatUtcHour(runHour)}</span> (
            {formatLocalHour(runHour)} your local time).
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" disabled={saveMutation.isPending} onClick={onClose}>
            Skip for now
          </Button>
          <Button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate(runHour)}
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save Schedule"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

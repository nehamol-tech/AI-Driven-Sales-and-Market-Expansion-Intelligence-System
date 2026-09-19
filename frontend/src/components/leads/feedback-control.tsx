"use client";

import * as React from "react";
import { ThumbsUp, ArrowUp, ArrowDown } from "lucide-react";
import type { FeedbackRating, LeadType } from "@ai-sales/shared";
import { useSubmitFeedback } from "@/hooks/use-leads";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/use-toast";
import { ApiError } from "@/lib/api-client";

const OPTIONS: { rating: FeedbackRating; label: string; icon: typeof ThumbsUp }[] = [
  { rating: "TOO_HIGH", label: "Too high", icon: ArrowUp },
  { rating: "ACCURATE", label: "Accurate", icon: ThumbsUp },
  { rating: "TOO_LOW", label: "Too low", icon: ArrowDown },
];

/** Rate-the-score control: three buttons + optional comment, tied to the
 * current lead's latest score on the backend. */
export function FeedbackControl({ leadType, leadId }: { leadType: LeadType; leadId: string }) {
  const [comment, setComment] = React.useState("");
  const [pendingRating, setPendingRating] = React.useState<FeedbackRating | null>(null);
  const [submitted, setSubmitted] = React.useState<FeedbackRating | null>(null);
  const submitFeedback = useSubmitFeedback(leadType);

  async function handleSubmit(rating: FeedbackRating) {
    setPendingRating(rating);
    try {
      await submitFeedback.mutateAsync({
        id: leadId,
        rating,
        comment: comment.trim() || undefined,
      });
      setSubmitted(rating);
      toast({ title: "Feedback submitted" });
    } catch (err) {
      toast({
        title: "Couldn't submit feedback",
        description: err instanceof ApiError ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setPendingRating(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const isChosen = submitted === opt.rating;
          return (
            <Button
              key={opt.rating}
              type="button"
              variant={isChosen ? "default" : "outline"}
              size="sm"
              isLoading={pendingRating === opt.rating}
              disabled={submitFeedback.isPending && pendingRating !== opt.rating}
              onClick={() => handleSubmit(opt.rating)}
            >
              <Icon className="mr-1.5 h-3.5 w-3.5" />
              {opt.label}
            </Button>
          );
        })}
      </div>
      <textarea
        placeholder="Optional comment..."
        rows={2}
        className="flex min-h-[60px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      {submitted ? (
        <p className="text-xs text-muted-foreground">
          Thanks — recorded as &quot;{OPTIONS.find((o) => o.rating === submitted)?.label}&quot;.
        </p>
      ) : null}
    </div>
  );
}

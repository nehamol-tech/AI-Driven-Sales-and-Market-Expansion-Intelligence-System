import { z } from "zod";
import { FEEDBACK_RATINGS } from "@ai-sales/shared";

export const leadFeedbackParamSchema = z.object({
  leadType: z.enum(["accounts", "prospects"]),
  id: z.string().trim().min(1),
});
export type LeadFeedbackParams = z.infer<typeof leadFeedbackParamSchema>;

export const submitFeedbackSchema = z.object({
  rating: z.enum(FEEDBACK_RATINGS),
  comment: z.string().trim().max(2000).nullable().optional(),
});
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackSchema>;

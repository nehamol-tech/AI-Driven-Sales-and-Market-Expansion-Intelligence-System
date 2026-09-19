import { z } from "zod";

export const assistantAskSchema = z.object({
  question: z.string().trim().min(1, "Question is required").max(300, "Question must be 300 characters or fewer"),
});
export type AssistantAskBody = z.infer<typeof assistantAskSchema>;

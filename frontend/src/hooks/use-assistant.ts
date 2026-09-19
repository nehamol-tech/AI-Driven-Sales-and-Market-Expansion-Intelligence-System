import { useMutation } from "@tanstack/react-query";
import type { AssistantAnswerDTO } from "@ai-sales/shared";
import { apiPost } from "@/lib/api-client";

/**
 * Asks "Ask Sales AI" a free-text question. Not cached — the backend answer
 * is ephemeral per the assistant's design, so this is a plain mutation the
 * chat page calls once per message rather than a query with a cache key.
 */
export function useAskAssistant() {
  return useMutation({
    mutationFn: (question: string) =>
      apiPost<AssistantAnswerDTO>("/assistant/ask", { question }),
  });
}

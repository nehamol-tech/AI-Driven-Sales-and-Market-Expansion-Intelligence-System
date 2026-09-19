import type { AIProvider, AIProviderCompletion, AIProviderOptions } from "../ai-provider.interface.js";

/**
 * Canned-response provider used when no API key is configured. Returns a
 * valid JSON payload matching the lead-scoring response schema
 * (`scoring.schema.ts`) so the whole pipeline — including zod validation —
 * is exercisable locally with `AI_PROVIDER=mock` and no API key.
 */
export class MockAIProvider implements AIProvider {
  readonly name = "mock";

  generateCompletion(_prompt: string, _options?: AIProviderOptions): Promise<AIProviderCompletion> {
    const payload = {
      score: 72,
      reasons: [
        {
          factor: "Order recency",
          signal: "positive" as const,
          detail: "Mock signal: the lead has recent purchase activity within the scoring window.",
        },
        {
          factor: "Order volume",
          signal: "positive" as const,
          detail: "Mock signal: order count and total order value are above the typical baseline.",
        },
        {
          factor: "Product fit",
          signal: "neutral" as const,
          detail: "Mock signal: partial alignment between the lead's industry and the company's target products.",
        },
      ],
      recommendedAction: {
        action: "Schedule a follow-up call",
        rationale: "Mock rationale: this is a canned response from the mock AI provider — no live model was called.",
      },
    };

    return Promise.resolve({
      content: JSON.stringify(payload),
      usage: undefined,
    });
  }
}

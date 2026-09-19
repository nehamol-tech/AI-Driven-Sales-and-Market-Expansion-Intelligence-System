import { describe, it, expect, vi } from "vitest";
import type { AIProvider, AIProviderCompletion } from "../../src/lib/ai/ai-provider.interface.js";
import {
  runAssistantNarrativePipeline,
  buildRuleBasedAnswer,
  validateNarrativeAnswer,
  askAssistant,
} from "../../src/modules/assistant/assistant.service.js";
import type { AssistantPrismaDeps } from "../../src/modules/assistant/intent-data.service.js";
import type { AssistantResultItem } from "@ai-sales/shared";

function makeFakeAIProvider(responses: (string | Error)[]): AIProvider {
  let call = 0;
  return {
    name: "fake",
    async generateCompletion(): Promise<AIProviderCompletion> {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      if (response instanceof Error) throw response;
      return { content: response, usage: undefined };
    },
  };
}

function makeThrowingAIProvider(): AIProvider {
  return {
    name: "must-not-be-called",
    async generateCompletion(): Promise<AIProviderCompletion> {
      throw new Error("AI provider should not have been called");
    },
  };
}

const sampleResults: AssistantResultItem[] = [
  { leadId: "acc_1", leadType: "accounts", name: "Acme Retail", score: null, classification: null, detail: "Overdue by 7 days (usual cycle ~30 days)" },
];

function makeDeps(overrides: Partial<AssistantPrismaDeps> = {}): AssistantPrismaDeps {
  return {
    account: { findMany: async () => [] },
    prospect: { findMany: async () => [] },
    leadScore: { findMany: async () => [] },
    salesRecord: { findMany: async () => [] },
    product: { findMany: async () => [] },
    ...overrides,
  };
}

/* -------------------------------------------------------------------------
 * validateNarrativeAnswer — basic shape validation.
 * ---------------------------------------------------------------------- */

describe("validateNarrativeAnswer", () => {
  it("rejects an empty (or whitespace-only) string", () => {
    expect(validateNarrativeAnswer("")).toBeNull();
    expect(validateNarrativeAnswer("   \n  ")).toBeNull();
  });

  it("rejects content that looks like JSON (the prompt explicitly asks for plain text)", () => {
    expect(validateNarrativeAnswer('{"score": 72}')).toBeNull();
    expect(validateNarrativeAnswer("[1, 2, 3]")).toBeNull();
  });

  it("rejects wildly-over-length content outright", () => {
    expect(validateNarrativeAnswer("x".repeat(10000))).toBeNull();
  });

  it("truncates content that is over the soft cap but not wildly so", () => {
    const result = validateNarrativeAnswer("x".repeat(2000));
    expect(result).not.toBeNull();
    expect(result!.length).toBe(1500);
  });

  it("accepts and trims a normal plain-text answer", () => {
    expect(validateNarrativeAnswer("  3 accounts are overdue for reorder.  ")).toBe("3 accounts are overdue for reorder.");
  });
});

/* -------------------------------------------------------------------------
 * buildRuleBasedAnswer — deterministic templates, honest on empty results.
 * ---------------------------------------------------------------------- */

describe("buildRuleBasedAnswer", () => {
  it("is honest (not padded) when results is empty, for every intent", () => {
    expect(buildRuleBasedAnswer("reorder_soon", [])).toMatch(/no accounts/i);
    expect(buildRuleBasedAnswer("inactive_customers", [])).toMatch(/no accounts/i);
    expect(buildRuleBasedAnswer("hot_leads", [])).toMatch(/no leads/i);
    expect(buildRuleBasedAnswer("product_recommendations", [])).toMatch(/no active products/i);
    expect(buildRuleBasedAnswer("high_value_accounts", [])).toMatch(/no account order history/i);
    expect(buildRuleBasedAnswer("today_priorities", [])).toMatch(/no customers or leads/i);
  });

  it("mentions the real result names when results is non-empty", () => {
    const answer = buildRuleBasedAnswer("reorder_soon", sampleResults);
    expect(answer).toContain("Acme Retail");
  });
});

/* -------------------------------------------------------------------------
 * Test #7: invalid/malformed AI output triggers the RULE_BASED fallback.
 * Test #8: AI call throwing triggers the RULE_BASED fallback (after retry).
 * ---------------------------------------------------------------------- */

describe("runAssistantNarrativePipeline", () => {
  it("returns an AI-narrated answer when the AI responds with valid plain text", async () => {
    const provider = makeFakeAIProvider(["3 accounts are overdue for reorder, including Acme Retail."]);
    const result = await runAssistantNarrativePipeline(provider, "reorder_soon", "Who is likely to reorder this week?", sampleResults);
    expect(result.method).toBe("AI");
    expect(result.answer).toBe("3 accounts are overdue for reorder, including Acme Retail.");
  });

  it("retries once on empty/malformed output, then succeeds if the retry is valid (test #7)", async () => {
    const provider = makeFakeAIProvider(["", "3 accounts are overdue for reorder."]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runAssistantNarrativePipeline(provider, "reorder_soon", "q", sampleResults);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("AI");
  });

  it("falls back to RULE_BASED after one retry when the AI keeps returning invalid output (test #7)", async () => {
    const provider = makeFakeAIProvider(["", '{"not": "plain text"}']);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runAssistantNarrativePipeline(provider, "reorder_soon", "q", sampleResults);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
    expect(result.answer).toBe(buildRuleBasedAnswer("reorder_soon", sampleResults));
  });

  it("falls back to RULE_BASED when the AI throws on both attempts (test #8)", async () => {
    const provider = makeFakeAIProvider([new Error("network error"), new Error("network error")]);
    const spy = vi.spyOn(provider, "generateCompletion");
    const result = await runAssistantNarrativePipeline(provider, "hot_leads", "q", sampleResults);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.method).toBe("RULE_BASED");
  });

  it("falls back to RULE_BASED when the AI throws once then returns invalid output", async () => {
    const provider = makeFakeAIProvider([new Error("network error"), ""]);
    const result = await runAssistantNarrativePipeline(provider, "hot_leads", "q", sampleResults);
    expect(result.method).toBe("RULE_BASED");
  });
});

/* -------------------------------------------------------------------------
 * askAssistant — top-level orchestration.
 * Test #9: an unmatched question never calls the AI provider at all.
 * Test #10: `results` is populated regardless of method (AI or RULE_BASED).
 * ---------------------------------------------------------------------- */

describe("askAssistant", () => {
  it("never calls the AI provider for an unmatched question (test #9)", async () => {
    const provider = makeThrowingAIProvider();
    const spy = vi.spyOn(provider, "generateCompletion");
    const deps = makeDeps();

    const dto = await askAssistant(deps, provider, { companyId: "c1", question: "what's the weather today" });

    expect(spy).not.toHaveBeenCalled();
    expect(dto.matchedIntentId).toBeNull();
    expect(dto.method).toBe("RULE_BASED");
    expect(dto.results).toEqual([]);
    expect(dto.suggestedQuestions.length).toBeGreaterThan(0);
  });

  it("populates `results` with real data when the AI path succeeds (test #10)", async () => {
    const deps = makeDeps({
      leadScore: {
        findMany: async () => [{ accountId: "acc_1", prospectId: null, score: 91, classification: "HOT", account: { name: "Acme" } }],
      },
    });
    const provider = makeFakeAIProvider(["1 lead is currently HOT: Acme."]);
    const dto = await askAssistant(deps, provider, { companyId: "c1", question: "Which HOT leads need attention?" });

    expect(dto.matchedIntentId).toBe("hot_leads");
    expect(dto.method).toBe("AI");
    expect(dto.results).toHaveLength(1);
    expect(dto.results[0].name).toBe("Acme");
  });

  it("populates `results` with real data when the AI path fails and RULE_BASED is used (test #10)", async () => {
    const deps = makeDeps({
      leadScore: {
        findMany: async () => [{ accountId: "acc_1", prospectId: null, score: 91, classification: "HOT", account: { name: "Acme" } }],
      },
    });
    const provider = makeFakeAIProvider([new Error("down"), new Error("down")]);
    const dto = await askAssistant(deps, provider, { companyId: "c1", question: "Which HOT leads need attention?" });

    expect(dto.matchedIntentId).toBe("hot_leads");
    expect(dto.method).toBe("RULE_BASED");
    expect(dto.results).toHaveLength(1);
    expect(dto.results[0].name).toBe("Acme");
    expect(dto.answer).toContain("Acme");
  });

  it("echoes the original question back verbatim and always includes the full suggested-questions list", async () => {
    const provider = makeFakeAIProvider(["ok"]);
    const deps = makeDeps();
    const dto = await askAssistant(deps, provider, { companyId: "c1", question: "Which customers have high-value potential?" });
    expect(dto.question).toBe("Which customers have high-value potential?");
    expect(dto.suggestedQuestions).toHaveLength(6);
  });

  it("honestly returns an empty results array (not fabricated data) when the matched intent has no real matches", async () => {
    const provider = makeFakeAIProvider(["Nothing currently matches."]);
    const deps = makeDeps(); // no accounts/leads/products at all
    const dto = await askAssistant(deps, provider, { companyId: "c1", question: "Which HOT leads need attention?" });
    expect(dto.matchedIntentId).toBe("hot_leads");
    expect(dto.results).toEqual([]);
  });
});

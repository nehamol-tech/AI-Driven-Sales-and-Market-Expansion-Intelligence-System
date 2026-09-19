import { ASSISTANT_SUGGESTED_QUESTIONS } from "@ai-sales/shared";
import type { AssistantAnswerDTO, AssistantIntentId, AssistantResultItem, ScoreMethod } from "@ai-sales/shared";
import type { AIProvider } from "../../lib/ai/ai-provider.interface.js";
import { matchIntent } from "./intent-matcher.js";
import { gatherIntentData, type AssistantPrismaDeps } from "./intent-data.service.js";
import { buildAssistantPrompt } from "./assistant.prompt.js";

const ASSISTANT_NARRATIVE_MAX_TOKENS = 400;

/** Soft cap — a longer AI answer is truncated to this length. */
const ASSISTANT_ANSWER_MAX_LENGTH = 1500;
/** Hard cap — past this the response is wildly over budget (likely malformed/rambling) and is rejected outright (triggers retry/fallback) rather than truncated. */
const ASSISTANT_ANSWER_REJECT_LENGTH = ASSISTANT_ANSWER_MAX_LENGTH * 4;

/**
 * Basic validation of the AI's plain-text narration: must be non-empty after
 * trimming, and not wildly over length. There's no structured shape to
 * validate here (unlike the JSON pipelines elsewhere in this codebase) since
 * this call's only output is free-text narration — nothing it returns is
 * trusted as an id/fact/decision downstream.
 */
export function validateNarrativeAnswer(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > ASSISTANT_ANSWER_REJECT_LENGTH) return null;
  // The prompt explicitly asks for plain text, never JSON — a response that
  // looks like a JSON object/array means the model ignored that instruction
  // (or, in local dev with AI_PROVIDER=mock, that MockAIProvider's canned
  // response — built for the unrelated lead-scoring JSON contract — was
  // returned as-is). Reject rather than surface raw JSON as a "narrative
  // answer"; the RULE_BASED fallback below is always a clean, honest
  // plain-text template either way.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  return trimmed.length > ASSISTANT_ANSWER_MAX_LENGTH ? trimmed.slice(0, ASSISTANT_ANSWER_MAX_LENGTH) : trimmed;
}

async function callAssistantNarrativeOnce(
  aiProvider: AIProvider,
  intentId: AssistantIntentId,
  question: string,
  results: AssistantResultItem[],
): Promise<string | null> {
  try {
    const prompt = buildAssistantPrompt(intentId, question, results);
    const completion = await aiProvider.generateCompletion(prompt, { maxTokens: ASSISTANT_NARRATIVE_MAX_TOKENS, temperature: 0.4 });
    return validateNarrativeAnswer(completion.content);
  } catch {
    return null;
  }
}

function joinNames(results: AssistantResultItem[], max = 5): string {
  const names = results.slice(0, max).map((r) => r.name);
  const suffix = results.length > max ? `, and ${results.length - max} more` : "";
  return names.join(", ") + suffix;
}

/**
 * Deterministic templated answer per intent — used by the RULE_BASED
 * fallback. Never AI, built directly and only from `results`, exactly the
 * same real rows the AI path would have been given.
 */
export function buildRuleBasedAnswer(intentId: AssistantIntentId, results: AssistantResultItem[]): string {
  const n = results.length;
  const plural = n === 1 ? "" : "s";
  const verb = n === 1 ? "is" : "are";

  switch (intentId) {
    case "today_priorities":
      return n === 0
        ? "No customers or leads were identified as a priority for today."
        : `You have ${n} priority item${plural} to focus on today: ${joinNames(results)}.`;
    case "reorder_soon":
      return n === 0
        ? "No accounts are currently due or overdue for reorder."
        : `${n} account${plural} ${verb} due or overdue for reorder: ${joinNames(results)}.`;
    case "inactive_customers":
      return n === 0
        ? "No accounts currently look like they're becoming inactive."
        : `${n} account${plural} ${verb} becoming inactive: ${joinNames(results)}.`;
    case "hot_leads":
      return n === 0
        ? "No leads are currently classified HOT."
        : `${n} lead${plural} ${verb} currently HOT: ${joinNames(results)}.`;
    case "product_recommendations":
      return n === 0
        ? "No active products currently match your HOT/WARM leads' industry or business type."
        : `Based on current HOT/WARM leads, the top matching product${plural} ${verb}: ${joinNames(results)}.`;
    case "high_value_accounts":
      return n === 0
        ? "No account order history is available yet to rank by value."
        : `Your highest-value account${plural}: ${joinNames(results)}.`;
    default: {
      const exhaustiveCheck: never = intentId;
      throw new Error(`Unhandled assistant intent: ${String(exhaustiveCheck)}`);
    }
  }
}

export interface AssistantNarrativeResult {
  answer: string;
  method: ScoreMethod;
}

/**
 * Calls the AI once, retries once on failure/invalid output, then falls
 * back to the transparent RULE_BASED template — mirrors
 * runNarrativePipeline in sales-agent.service.ts, just for one question's
 * plain-text answer instead of a batch of structured entries.
 */
export async function runAssistantNarrativePipeline(
  aiProvider: AIProvider,
  intentId: AssistantIntentId,
  question: string,
  results: AssistantResultItem[],
): Promise<AssistantNarrativeResult> {
  let answer = await callAssistantNarrativeOnce(aiProvider, intentId, question, results);
  if (!answer) {
    answer = await callAssistantNarrativeOnce(aiProvider, intentId, question, results); // one retry
  }

  if (answer) {
    return { answer, method: "AI" };
  }
  return { answer: buildRuleBasedAnswer(intentId, results), method: "RULE_BASED" };
}

const UNMATCHED_ANSWER =
  "I don't have a way to answer that yet. Try one of the suggested questions below, or rephrase your question to match one of those topics.";

export interface AskAssistantParams {
  companyId: string;
  question: string;
  now?: Date;
}

/**
 * Top-level orchestration for one "ask": match intent (deterministic, no
 * AI, no I/O) -> gather real data for that intent (no AI) -> narrate via AI
 * with retry+fallback. Nothing is persisted — every call is a fresh
 * request, no conversation history is kept server-side.
 *
 * When no intent matches, this responds immediately with an honest
 * RULE_BASED message and never calls the AI provider at all — both a cost
 * control and a correctness guarantee: the assistant never guesses at an
 * out-of-scope question.
 */
export async function askAssistant(deps: AssistantPrismaDeps, aiProvider: AIProvider, params: AskAssistantParams): Promise<AssistantAnswerDTO> {
  const matchedIntentId = matchIntent(params.question);

  if (!matchedIntentId) {
    return {
      question: params.question,
      matchedIntentId: null,
      answer: UNMATCHED_ANSWER,
      method: "RULE_BASED",
      results: [],
      suggestedQuestions: ASSISTANT_SUGGESTED_QUESTIONS,
    };
  }

  const results = await gatherIntentData(deps, aiProvider, params.companyId, matchedIntentId, params.now);
  const { answer, method } = await runAssistantNarrativePipeline(aiProvider, matchedIntentId, params.question, results);

  return {
    question: params.question,
    matchedIntentId,
    answer,
    method,
    results,
    suggestedQuestions: ASSISTANT_SUGGESTED_QUESTIONS,
  };
}

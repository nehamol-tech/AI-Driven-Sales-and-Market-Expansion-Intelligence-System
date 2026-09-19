import type { LeadClassification, LeadType, ScoreMethod } from "./leads.js";

/**
 * The fixed set of question intents the assistant can answer. Free-text
 * questions are matched (deterministically, no AI involved in matching) to
 * the closest one of these — the assistant never lets the AI decide what
 * data to fetch, only how to phrase already-fetched real data.
 */
export const ASSISTANT_INTENT_IDS = [
  "today_priorities",
  "reorder_soon",
  "inactive_customers",
  "hot_leads",
  "product_recommendations",
  "high_value_accounts",
] as const;
export type AssistantIntentId = (typeof ASSISTANT_INTENT_IDS)[number];

export interface AssistantSuggestedQuestion {
  intentId: AssistantIntentId;
  question: string;
}

/**
 * The fixed suggested-question chips shown in the UI, and the canonical
 * display phrasing for each intent — shared so backend intent matching and
 * frontend chips can never drift apart.
 */
export const ASSISTANT_SUGGESTED_QUESTIONS: AssistantSuggestedQuestion[] = [
  { intentId: "today_priorities", question: "Which customers should I call today?" },
  { intentId: "reorder_soon", question: "Who is likely to reorder this week?" },
  { intentId: "inactive_customers", question: "Which customers are becoming inactive?" },
  { intentId: "hot_leads", question: "Which HOT leads need attention?" },
  { intentId: "product_recommendations", question: "What products should I recommend?" },
  { intentId: "high_value_accounts", question: "Which customers have high-value potential?" },
];

/** One real, grounded row of supporting data behind the assistant's answer — always rendered alongside the narrative, never replaced by it. */
export interface AssistantResultItem {
  leadId: string;
  leadType: LeadType;
  name: string;
  score: number | null;
  classification: LeadClassification | null;
  /** A short, real, human-readable fact about this item, e.g. "Overdue by 7 days" or "Total value ₹18,000". Never AI-generated — built directly from real data. */
  detail: string;
}

export interface AssistantAnswerDTO {
  /** The user's question, echoed back. */
  question: string;
  /** null when no supported intent matched confidently enough — `answer` explains this and `suggestedQuestions` lists what's supported. */
  matchedIntentId: AssistantIntentId | null;
  /** AI-phrased (or RULE_BASED templated) natural-language answer, grounded strictly in `results` — never a source of new facts. */
  answer: string;
  method: ScoreMethod;
  results: AssistantResultItem[];
  suggestedQuestions: AssistantSuggestedQuestion[];
}

export interface AssistantAskInput {
  question: string;
}

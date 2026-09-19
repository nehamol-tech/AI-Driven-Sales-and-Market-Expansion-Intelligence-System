import { ASSISTANT_INTENT_IDS, type AssistantIntentId } from "@ai-sales/shared";

/* -------------------------------------------------------------------------
 * Deterministic intent matching. Pure function, no AI, no I/O — the AI never
 * decides what data to fetch; this is the only thing that does, and it's
 * plain keyword/substring scoring.
 *
 * Approach:
 *  1. Normalize the question: lowercase, strip apostrophes, turn hyphens
 *     into spaces (so "high-value" and "high value" match the same
 *     trigger, "re-order" and "reorder" can be listed as distinct
 *     triggers), strip remaining punctuation, collapse whitespace.
 *  2. Each of the 6 intents has a fixed list of trigger phrases, each with
 *     an integer weight:
 *       - weight 2 ("strong"): a short phrase or single word that is
 *         reasonably unambiguous in a B2B sales context (e.g. "reorder",
 *         "churn", "hot leads", "high value").
 *       - weight 1 ("weak"): a common English word that's on-topic but
 *         too generic to trust alone (e.g. "today", "product") — it only
 *         tips the balance combined with another matched trigger.
 *     A trigger matches if its phrase appears anywhere in the normalized
 *     question (substring match). An intent's score is the sum of the
 *     weights of every trigger that matched.
 *  3. The intent with the highest score wins, provided that score is >=
 *     ASSISTANT_MATCH_THRESHOLD (2). If two or more intents tie for the
 *     top score (and that score is > 0), the question is ambiguous and
 *     the result is `null` rather than an arbitrary pick.
 *
 * Threshold rationale: requiring >= 2 means a single generic weak trigger
 * (e.g. bare "today" appearing in an unrelated question like "what's the
 * weather today") can never match on its own — it takes either one strong
 * trigger, or two weak ones, to clear the bar. This was tuned so every
 * phrasing in ASSISTANT_SUGGESTED_QUESTIONS clears its own intent's
 * threshold with room to spare (see intent-matcher.test.ts).
 * ---------------------------------------------------------------------- */

export const ASSISTANT_MATCH_THRESHOLD = 2;

interface Trigger {
  phrase: string;
  weight: 1 | 2;
}

function strong(phrase: string): Trigger {
  return { phrase, weight: 2 };
}
function weak(phrase: string): Trigger {
  return { phrase, weight: 1 };
}

/**
 * Trigger phrases must already be in normalized form (lowercase, no
 * hyphens/apostrophes/punctuation) since they're matched against the
 * normalized question — see `normalizeQuestion`.
 */
const INTENT_TRIGGERS: Record<AssistantIntentId, Trigger[]> = {
  today_priorities: [
    strong("call today"),
    strong("who should i call"),
    strong("priorit"), // covers priority/priorities/prioritize/prioritise
    strong("top priority"),
    strong("call list"),
    strong("focus today"),
    weak("today"),
    weak("call now"),
  ],
  reorder_soon: [
    strong("reorder"),
    strong("re order"),
    strong("order again"),
    strong("reorder soon"),
    strong("likely to reorder"),
    strong("due for reorder"),
    strong("restock"),
    strong("ordering again"),
    weak("due for"),
    weak("will reorder"),
  ],
  inactive_customers: [
    strong("inactive"),
    strong("going cold"),
    strong("gone cold"),
    strong("havent ordered"),
    strong("hasnt ordered"),
    strong("have not ordered"),
    strong("at risk"),
    strong("churn"),
    strong("becoming inactive"),
    strong("stopped ordering"),
    strong("lapsed"),
    strong("dormant"),
    strong("no longer ordering"),
    weak("cold"),
  ],
  hot_leads: [
    strong("hot lead"),
    strong("hot leads"),
    strong("need attention"),
    strong("urgent"),
    strong("hottest"),
    strong("hot accounts"),
    strong("who is hot"),
    weak("hot"),
  ],
  product_recommendations: [
    strong("which product"),
    strong("what should i sell"),
    strong("what to sell"),
    strong("best product"),
    strong("product suggestion"),
    strong("recommend a product"),
    strong("product recommendation"),
    strong("suggest a product"),
    weak("product"),
    weak("recommend"),
  ],
  high_value_accounts: [
    strong("high value"),
    strong("most valuable"),
    strong("top customer"),
    strong("top customers"),
    strong("highest value"),
    strong("biggest accounts"),
    strong("big spenders"),
    strong("best customers"),
    weak("biggest"),
    weak("valuable"),
  ],
};

function normalizeQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/['‘’]/g, "") // strip apostrophes: "haven't" -> "havent"
    .replace(/[-–—]/g, " ") // hyphens/dashes -> space
    .replace(/[^a-z0-9\s]/g, " ") // strip remaining punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function scoreIntent(normalized: string, triggers: Trigger[]): number {
  let score = 0;
  for (const trigger of triggers) {
    if (normalized.includes(trigger.phrase)) {
      score += trigger.weight;
    }
  }
  return score;
}

/**
 * Matches a free-text question to one of the 6 fixed intents, or `null` if
 * nothing scores high enough / the result is ambiguous. Never throws, never
 * calls out to anything — pure and synchronous by design so it's trivially
 * unit-testable and carries zero AI/DB cost for out-of-scope questions.
 */
export function matchIntent(question: string): AssistantIntentId | null {
  const normalized = normalizeQuestion(question);
  if (!normalized) return null;

  let bestIntentId: AssistantIntentId | null = null;
  let bestScore = 0;
  let tied = false;

  for (const intentId of ASSISTANT_INTENT_IDS) {
    const score = scoreIntent(normalized, INTENT_TRIGGERS[intentId]);
    if (score > bestScore) {
      bestScore = score;
      bestIntentId = intentId;
      tied = false;
    } else if (score === bestScore && score > 0) {
      tied = true;
    }
  }

  if (bestScore < ASSISTANT_MATCH_THRESHOLD || tied) {
    return null;
  }
  return bestIntentId;
}

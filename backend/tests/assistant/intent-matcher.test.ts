import { describe, it, expect } from "vitest";
import { ASSISTANT_SUGGESTED_QUESTIONS } from "@ai-sales/shared";
import { matchIntent } from "../../src/modules/assistant/intent-matcher.js";

/* -------------------------------------------------------------------------
 * Test #1: every canonical suggested question matches its own intent.
 * ---------------------------------------------------------------------- */

describe("matchIntent — canonical ASSISTANT_SUGGESTED_QUESTIONS phrasings", () => {
  for (const { intentId, question } of ASSISTANT_SUGGESTED_QUESTIONS) {
    it(`"${question}" -> ${intentId}`, () => {
      expect(matchIntent(question)).toBe(intentId);
    });
  }
});

/* -------------------------------------------------------------------------
 * Test #2: paraphrases (not the exact suggested text) also match correctly —
 * proves the matcher isn't just doing exact string comparison.
 * ---------------------------------------------------------------------- */

describe("matchIntent — paraphrases", () => {
  const paraphrases: { question: string; expected: (typeof ASSISTANT_SUGGESTED_QUESTIONS)[number]["intentId"] }[] = [
    { question: "who should I prioritize today?", expected: "today_priorities" },
    { question: "give me my call list for today", expected: "today_priorities" },
    { question: "what's my top priority right now", expected: "today_priorities" },
    { question: "which accounts are due for a reorder soon", expected: "reorder_soon" },
    { question: "who needs to order again this week", expected: "reorder_soon" },
    { question: "any accounts due for a re-order?", expected: "reorder_soon" },
    { question: "which customers have gone cold on us", expected: "inactive_customers" },
    { question: "any accounts at risk of churn", expected: "inactive_customers" },
    { question: "who hasn't ordered in a while", expected: "inactive_customers" },
    { question: "show me the hottest leads right now", expected: "hot_leads" },
    { question: "which hot accounts need urgent attention", expected: "hot_leads" },
    { question: "what should I sell to my current leads", expected: "product_recommendations" },
    { question: "any product suggestions for our leads", expected: "product_recommendations" },
    { question: "who are our most valuable customers", expected: "high_value_accounts" },
    { question: "show me the biggest accounts by spend", expected: "high_value_accounts" },
  ];

  for (const { question, expected } of paraphrases) {
    it(`"${question}" -> ${expected}`, () => {
      expect(matchIntent(question)).toBe(expected);
    });
  }
});

/* -------------------------------------------------------------------------
 * Test #3: clearly out-of-scope questions return null.
 * ---------------------------------------------------------------------- */

describe("matchIntent — out-of-scope questions", () => {
  const outOfScope = [
    "what's the weather",
    "what's the weather like today",
    "delete all my data",
    "delete all accounts",
    "tell me a joke",
    "what is the capital of France",
    "how do I reset my password",
    "",
    "   ",
    "asdkjaslkdj qwoiue",
  ];

  for (const question of outOfScope) {
    it(`"${question}" -> null`, () => {
      expect(matchIntent(question)).toBeNull();
    });
  }
});

describe("matchIntent — case/whitespace insensitivity", () => {
  it("matches regardless of case and extra whitespace", () => {
    expect(matchIntent("  WHICH   Customers Should I CALL Today?  ")).toBe("today_priorities");
  });
});

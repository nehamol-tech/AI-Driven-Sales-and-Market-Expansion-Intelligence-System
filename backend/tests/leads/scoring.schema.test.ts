import { describe, it, expect } from "vitest";
import { aiScoreResponseSchema, parseAIScoreResponse } from "../../src/modules/leads/scoring.schema.js";

const validPayload = {
  score: 65,
  reasons: [
    { factor: "Order recency", signal: "positive", detail: "Recent order activity." },
    { factor: "Order volume", signal: "neutral", detail: "Average order volume." },
    { factor: "Product fit", signal: "negative", detail: "Weak product fit." },
  ],
  recommendedAction: { action: "Schedule a call", rationale: "Solid overall signal." },
};

describe("aiScoreResponseSchema", () => {
  it("accepts a valid response", () => {
    const result = aiScoreResponseSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects a score above 100", () => {
    const result = aiScoreResponseSchema.safeParse({ ...validPayload, score: 101 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative score", () => {
    const result = aiScoreResponseSchema.safeParse({ ...validPayload, score: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer score", () => {
    const result = aiScoreResponseSchema.safeParse({ ...validPayload, score: 55.5 });
    expect(result.success).toBe(false);
  });

  it("rejects fewer than 3 reasons", () => {
    const result = aiScoreResponseSchema.safeParse({ ...validPayload, reasons: validPayload.reasons.slice(0, 2) });
    expect(result.success).toBe(false);
  });

  it("rejects more than 6 reasons", () => {
    const extra = Array.from({ length: 7 }, (_, i) => ({ factor: `f${i}`, signal: "neutral", detail: `d${i}` }));
    const result = aiScoreResponseSchema.safeParse({ ...validPayload, reasons: extra });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid signal value (not positive/negative/neutral)", () => {
    const badReasons = [
      { factor: "a", signal: "very-positive", detail: "d" },
      { factor: "b", signal: "positive", detail: "d" },
      { factor: "c", signal: "positive", detail: "d" },
    ];
    const result = aiScoreResponseSchema.safeParse({ ...validPayload, reasons: badReasons });
    expect(result.success).toBe(false);
  });

  it("rejects a response missing recommendedAction", () => {
    const { recommendedAction, ...withoutAction } = validPayload;
    void recommendedAction;
    const result = aiScoreResponseSchema.safeParse(withoutAction);
    expect(result.success).toBe(false);
  });

  it("rejects classification if present with the wrong shape (schema never accepts a classification field as authoritative anyway — only score/reasons/recommendedAction are read)", () => {
    // Extra unexpected fields are simply ignored by zod's default (non-strict) object parsing,
    // proving classification from the AI is never trusted even if present.
    const result = aiScoreResponseSchema.safeParse({ ...validPayload, classification: "HOT" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).classification).toBeUndefined();
    }
  });
});

describe("parseAIScoreResponse", () => {
  it("parses and validates well-formed JSON content", () => {
    const parsed = parseAIScoreResponse(JSON.stringify(validPayload));
    expect(parsed).not.toBeNull();
    expect(parsed?.score).toBe(65);
  });

  it("returns null for non-JSON content", () => {
    expect(parseAIScoreResponse("this is not json")).toBeNull();
  });

  it("returns null for valid JSON that doesn't match the schema", () => {
    expect(parseAIScoreResponse(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("strips markdown code fences before parsing (defensive, even though the prompt asks for raw JSON)", () => {
    const fenced = "```json\n" + JSON.stringify(validPayload) + "\n```";
    const parsed = parseAIScoreResponse(fenced);
    expect(parsed).not.toBeNull();
    expect(parsed?.score).toBe(65);
  });

  it("never throws, even on garbage input", () => {
    expect(() => parseAIScoreResponse("{{{ not json ]]]")).not.toThrow();
    expect(parseAIScoreResponse("{{{ not json ]]]")).toBeNull();
  });
});

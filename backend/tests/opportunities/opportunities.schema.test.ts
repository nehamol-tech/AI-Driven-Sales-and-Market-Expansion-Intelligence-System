import { describe, it, expect } from "vitest";
import { aiOpportunityEntrySchema, parseAIOpportunityResponse } from "../../src/modules/opportunities/opportunities.schema.js";

describe("aiOpportunityEntrySchema", () => {
  it("accepts a well-formed entry", () => {
    const result = aiOpportunityEntrySchema.safeParse({ id: "REORDER-acc_1", narrative: "Real narrative.", recommendedAction: "Call today." });
    expect(result.success).toBe(true);
  });

  it("STRIPS extra fields (type/score/classification/productId) rather than rejecting the entry — documented chosen behavior (test #12): there is structurally nothing surviving parse for the AI to override with", () => {
    const raw = {
      id: "REORDER-acc_1",
      narrative: "Real narrative.",
      recommendedAction: "Call today.",
      // None of these should survive validation, even though they're present in the raw payload:
      type: "HIGH_VALUE",
      score: 999,
      classification: "HOT",
      productId: "invented_product",
      priority: "HIGH",
    };
    const result = aiOpportunityEntrySchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "REORDER-acc_1", narrative: "Real narrative.", recommendedAction: "Call today." });
      expect(Object.keys(result.data)).toEqual(["id", "narrative", "recommendedAction"]);
      expect((result.data as Record<string, unknown>).type).toBeUndefined();
      expect((result.data as Record<string, unknown>).score).toBeUndefined();
      expect((result.data as Record<string, unknown>).classification).toBeUndefined();
      expect((result.data as Record<string, unknown>).productId).toBeUndefined();
    }
  });

  it("rejects a missing/empty id", () => {
    expect(aiOpportunityEntrySchema.safeParse({ id: "", narrative: "x", recommendedAction: "y" }).success).toBe(false);
  });

  it("rejects a missing narrative/recommendedAction", () => {
    expect(aiOpportunityEntrySchema.safeParse({ id: "x", recommendedAction: "y" }).success).toBe(false);
    expect(aiOpportunityEntrySchema.safeParse({ id: "x", narrative: "y" }).success).toBe(false);
  });
});

describe("parseAIOpportunityResponse", () => {
  const requestedIds = ["REORDER-acc_1", "AT_RISK-acc_2"];

  function validPayload(ids: string[] = requestedIds): string {
    return JSON.stringify(ids.map((id) => ({ id, narrative: "Real narrative.", recommendedAction: "Do something." })));
  }

  it("accepts a valid full bijection", () => {
    const result = parseAIOpportunityResponse(validPayload(), requestedIds);
    expect(result).not.toBeNull();
    expect(result?.map((e) => e.id).sort()).toEqual([...requestedIds].sort());
  });

  it("strips markdown code fences before parsing", () => {
    const fenced = "```json\n" + validPayload() + "\n```";
    expect(parseAIOpportunityResponse(fenced, requestedIds)).not.toBeNull();
  });

  it("rejects malformed (non-JSON) content, returning null (feeds the RULE_BASED fallback path)", () => {
    expect(parseAIOpportunityResponse("this is not json", requestedIds)).toBeNull();
  });

  it("rejects an invented id not among the requested ids (bijection mismatch — test #13)", () => {
    const payload = JSON.stringify([
      { id: "REORDER-acc_1", narrative: "x", recommendedAction: "y" },
      { id: "INVENTED-acc_9", narrative: "x", recommendedAction: "y" },
    ]);
    expect(parseAIOpportunityResponse(payload, requestedIds)).toBeNull();
  });

  it("rejects a response missing one of the requested ids (bijection mismatch — test #13)", () => {
    const payload = validPayload(["REORDER-acc_1"]); // AT_RISK-acc_2 omitted
    expect(parseAIOpportunityResponse(payload, requestedIds)).toBeNull();
  });

  it("rejects a duplicated id (bijection mismatch — test #13)", () => {
    const payload = JSON.stringify([
      { id: "REORDER-acc_1", narrative: "x", recommendedAction: "y" },
      { id: "REORDER-acc_1", narrative: "x2", recommendedAction: "y2" },
    ]);
    expect(parseAIOpportunityResponse(payload, requestedIds)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(parseAIOpportunityResponse("[]", requestedIds)).toBeNull();
  });
});

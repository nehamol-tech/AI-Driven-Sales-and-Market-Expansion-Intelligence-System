import { describe, it, expect } from "vitest";
import { aiSalesAgentResponseSchema, parseAISalesAgentResponse, salesAgentTodayQuerySchema } from "../../src/modules/sales-agent/sales-agent.schema.js";

const requestedLeadIds = ["lead_1", "lead_2"];
const productAllowlist = new Map<string, string[]>([
  ["lead_1", ["Widget A", "Widget B"]],
  ["lead_2", []],
]);

function validPayload() {
  return [
    { leadId: "lead_1", reasons: ["HOT classification (score 91)"], recommendedAction: "Contact today", productSuggestion: "Widget A" },
    { leadId: "lead_2", reasons: ["WARM classification (score 55)"], recommendedAction: "Follow up this week", productSuggestion: null },
  ];
}

describe("aiSalesAgentEntrySchema / aiSalesAgentResponseSchema (shape only)", () => {
  it("accepts a well-formed array", () => {
    expect(aiSalesAgentResponseSchema.safeParse(validPayload()).success).toBe(true);
  });

  it("rejects an empty array", () => {
    expect(aiSalesAgentResponseSchema.safeParse([]).success).toBe(false);
  });

  it("rejects an entry with no reasons", () => {
    const bad = [{ ...validPayload()[0], reasons: [] }];
    expect(aiSalesAgentResponseSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects an entry missing recommendedAction", () => {
    const { recommendedAction, ...rest } = validPayload()[0];
    void recommendedAction;
    expect(aiSalesAgentResponseSchema.safeParse([rest]).success).toBe(false);
  });

  it("accepts productSuggestion: null", () => {
    const ok = [{ ...validPayload()[0], productSuggestion: null }];
    expect(aiSalesAgentResponseSchema.safeParse(ok).success).toBe(true);
  });
});

describe("parseAISalesAgentResponse", () => {
  it("returns the parsed entries for a fully valid, matching batch", () => {
    const parsed = parseAISalesAgentResponse(JSON.stringify(validPayload()), requestedLeadIds, productAllowlist);
    expect(parsed).not.toBeNull();
    expect(parsed?.map((e) => e.leadId).sort()).toEqual(["lead_1", "lead_2"]);
  });

  it("returns null for non-JSON content", () => {
    expect(parseAISalesAgentResponse("not json", requestedLeadIds, productAllowlist)).toBeNull();
  });

  it("strips markdown code fences defensively", () => {
    const fenced = "```json\n" + JSON.stringify(validPayload()) + "\n```";
    expect(parseAISalesAgentResponse(fenced, requestedLeadIds, productAllowlist)).not.toBeNull();
  });

  it("rejects a leadId that was never requested (invented leadId)", () => {
    const withExtra = [...validPayload(), { leadId: "lead_999", reasons: ["r"], recommendedAction: "a", productSuggestion: null }];
    expect(parseAISalesAgentResponse(JSON.stringify(withExtra), requestedLeadIds, productAllowlist)).toBeNull();
  });

  it("rejects a response missing one of the requested leadIds (partial batch)", () => {
    const partial = [validPayload()[0]];
    expect(parseAISalesAgentResponse(JSON.stringify(partial), requestedLeadIds, productAllowlist)).toBeNull();
  });

  it("rejects a duplicate leadId within the response", () => {
    const dup = [validPayload()[0], validPayload()[0]];
    expect(parseAISalesAgentResponse(JSON.stringify(dup), ["lead_1"], productAllowlist)).toBeNull();
  });

  it("rejects a productSuggestion that is not in that lead's real candidate-product allowlist (test #7: AI cannot invent a product)", () => {
    const invented = validPayload();
    invented[0].productSuggestion = "Widget Z (not real)";
    expect(parseAISalesAgentResponse(JSON.stringify(invented), requestedLeadIds, productAllowlist)).toBeNull();
  });

  it("rejects a productSuggestion for a lead whose real allowlist is empty", () => {
    const bad = validPayload();
    bad[1].productSuggestion = "Widget A"; // lead_2's allowlist is []
    expect(parseAISalesAgentResponse(JSON.stringify(bad), requestedLeadIds, productAllowlist)).toBeNull();
  });

  it("accepts productSuggestion: null even when the lead has real candidate products available", () => {
    const declineSuggestion = validPayload();
    declineSuggestion[0].productSuggestion = null;
    expect(parseAISalesAgentResponse(JSON.stringify(declineSuggestion), requestedLeadIds, productAllowlist)).not.toBeNull();
  });

  it("never throws on garbage input", () => {
    expect(() => parseAISalesAgentResponse("{{{ not json ]]]", requestedLeadIds, productAllowlist)).not.toThrow();
    expect(parseAISalesAgentResponse("{{{ not json ]]]", requestedLeadIds, productAllowlist)).toBeNull();
  });
});

describe("salesAgentTodayQuerySchema", () => {
  it("defaults limit and force when absent", () => {
    const parsed = salesAgentTodayQuerySchema.parse({});
    expect(parsed.limit).toBe(10);
    expect(parsed.force).toBe(false);
  });

  it("coerces limit from a query string and parses force=true", () => {
    const parsed = salesAgentTodayQuerySchema.parse({ limit: "5", force: "true" });
    expect(parsed.limit).toBe(5);
    expect(parsed.force).toBe(true);
  });

  it("rejects a limit above the max", () => {
    expect(salesAgentTodayQuerySchema.safeParse({ limit: "9999" }).success).toBe(false);
  });
});

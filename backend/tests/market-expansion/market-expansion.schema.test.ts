import { describe, it, expect } from "vitest";
import { aiMarketExpansionEntrySchema, parseAIMarketExpansionResponse } from "../../src/modules/market-expansion/market-expansion.schema.js";

describe("aiMarketExpansionEntrySchema", () => {
  it("accepts a well-formed entry", () => {
    const result = aiMarketExpansionEntrySchema.safeParse({
      stateId: "st_1",
      narrative: "Real narrative from the given evidence.",
      hypothesisStatements: [{ productId: "prod_a", statement: "Manufacturing accounts may be worth investigating for Product A." }],
    });
    expect(result.success).toBe(true);
  });

  it("defaults hypothesisStatements to an empty array when omitted", () => {
    const result = aiMarketExpansionEntrySchema.safeParse({ stateId: "st_1", narrative: "x" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.hypothesisStatements).toEqual([]);
  });

  it("STRIPS extra fields (score/classification/counts) rather than rejecting the entry — there is structurally nothing for the AI to override", () => {
    const raw = {
      stateId: "st_1",
      narrative: "x",
      hypothesisStatements: [],
      score: 999,
      classification: "HIGH_OPPORTUNITY",
      accountCount: 1000,
      totalSalesValue: "9999999",
    };
    const result = aiMarketExpansionEntrySchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toEqual(["stateId", "narrative", "hypothesisStatements"]);
      expect((result.data as Record<string, unknown>).score).toBeUndefined();
      expect((result.data as Record<string, unknown>).classification).toBeUndefined();
    }
  });

  it("rejects a missing/empty stateId or narrative", () => {
    expect(aiMarketExpansionEntrySchema.safeParse({ stateId: "", narrative: "x" }).success).toBe(false);
    expect(aiMarketExpansionEntrySchema.safeParse({ stateId: "st_1", narrative: "" }).success).toBe(false);
  });
});

describe("parseAIMarketExpansionResponse", () => {
  const requestedIds = ["st_1", "st_2"];

  function validPayload(ids: string[] = requestedIds, hypotheses: Record<string, { productId: string; statement: string }[]> = {}): string {
    return JSON.stringify(ids.map((id) => ({ stateId: id, narrative: "Real narrative.", hypothesisStatements: hypotheses[id] ?? [] })));
  }

  it("accepts a valid full bijection with no hypotheses", () => {
    const result = parseAIMarketExpansionResponse(validPayload(), requestedIds, new Set());
    expect(result).not.toBeNull();
    expect(result?.map((e) => e.stateId).sort()).toEqual([...requestedIds].sort());
  });

  it("strips markdown code fences before parsing", () => {
    const fenced = "```json\n" + validPayload() + "\n```";
    expect(parseAIMarketExpansionResponse(fenced, requestedIds, new Set())).not.toBeNull();
  });

  it("rejects malformed (non-JSON) content, returning null", () => {
    expect(parseAIMarketExpansionResponse("this is not json", requestedIds, new Set())).toBeNull();
  });

  it("rejects an invented stateId not among the requested ids — test #11", () => {
    const payload = JSON.stringify([
      { stateId: "st_1", narrative: "x", hypothesisStatements: [] },
      { stateId: "st_999_INVENTED", narrative: "x", hypothesisStatements: [] },
    ]);
    expect(parseAIMarketExpansionResponse(payload, requestedIds, new Set())).toBeNull();
  });

  it("rejects a response missing one of the requested stateIds", () => {
    const payload = validPayload(["st_1"]); // st_2 omitted
    expect(parseAIMarketExpansionResponse(payload, requestedIds, new Set())).toBeNull();
  });

  it("rejects a duplicated stateId", () => {
    const payload = JSON.stringify([
      { stateId: "st_1", narrative: "x", hypothesisStatements: [] },
      { stateId: "st_1", narrative: "x2", hypothesisStatements: [] },
    ]);
    expect(parseAIMarketExpansionResponse(payload, requestedIds, new Set())).toBeNull();
  });

  it("accepts a hypothesis pairing that IS in the real allowlist", () => {
    const payload = validPayload(requestedIds, { st_1: [{ productId: "prod_a", statement: "x may be worth investigating." }] });
    const allowlist = new Set(["st_1:prod_a"]);
    const result = parseAIMarketExpansionResponse(payload, requestedIds, allowlist);
    expect(result).not.toBeNull();
  });

  it("rejects an invented product/state hypothesis pairing not in the real allowlist — test #12", () => {
    const payload = validPayload(requestedIds, { st_1: [{ productId: "prod_INVENTED", statement: "x may be worth investigating." }] });
    const allowlist = new Set(["st_1:prod_a"]); // prod_INVENTED was never a real candidate for st_1
    expect(parseAIMarketExpansionResponse(payload, requestedIds, allowlist)).toBeNull();
  });

  it("rejects a real pairing attached to the WRONG state (cross-state pairing confusion is still an invented pairing)", () => {
    const payload = validPayload(requestedIds, { st_2: [{ productId: "prod_a", statement: "x may be worth investigating." }] });
    const allowlist = new Set(["st_1:prod_a"]); // prod_a was only a real candidate for st_1, not st_2
    expect(parseAIMarketExpansionResponse(payload, requestedIds, allowlist)).toBeNull();
  });

  it("rejects a duplicate productId within one state's hypothesisStatements", () => {
    const payload = JSON.stringify([
      {
        stateId: "st_1",
        narrative: "x",
        hypothesisStatements: [
          { productId: "prod_a", statement: "a" },
          { productId: "prod_a", statement: "b" },
        ],
      },
      { stateId: "st_2", narrative: "x", hypothesisStatements: [] },
    ]);
    const allowlist = new Set(["st_1:prod_a"]);
    expect(parseAIMarketExpansionResponse(payload, requestedIds, allowlist)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(parseAIMarketExpansionResponse("[]", requestedIds, new Set())).toBeNull();
  });
});

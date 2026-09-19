import { describe, it, expect } from "vitest";
import { parseAIOptimizationResponse } from "../../src/modules/optimization/optimization.schema.js";

function validJson(ids: string[]): string {
  return JSON.stringify(ids.map((id) => ({ id, narrative: "A real narrative from the given evidence." })));
}

describe("parseAIOptimizationResponse", () => {
  it("accepts a valid array response matching the requested ids exactly", () => {
    const result = parseAIOptimizationResponse(validJson(["opt_1", "opt_2"]), ["opt_1", "opt_2"]);
    expect(result).not.toBeNull();
    expect(result?.map((e) => e.id)).toEqual(["opt_1", "opt_2"]);
  });

  it("accepts a markdown-fenced JSON response", () => {
    const fenced = "```json\n" + validJson(["opt_1"]) + "\n```";
    const result = parseAIOptimizationResponse(fenced, ["opt_1"]);
    expect(result).not.toBeNull();
    expect(result?.[0].id).toBe("opt_1");
  });

  it("accepts a plain (unlabeled) fenced JSON response", () => {
    const fenced = "```\n" + validJson(["opt_1"]) + "\n```";
    const result = parseAIOptimizationResponse(fenced, ["opt_1"]);
    expect(result).not.toBeNull();
  });

  it("returns null on malformed JSON", () => {
    expect(parseAIOptimizationResponse("not json at all", ["opt_1"])).toBeNull();
  });

  it("returns null when a requested id is missing from the response", () => {
    const result = parseAIOptimizationResponse(validJson(["opt_1"]), ["opt_1", "opt_2"]);
    expect(result).toBeNull();
  });

  it("returns null when the response contains an id that was never requested (invented id)", () => {
    const result = parseAIOptimizationResponse(validJson(["opt_999"]), ["opt_1"]);
    expect(result).toBeNull();
  });

  it("returns null when the response duplicates an id", () => {
    const duplicated = JSON.stringify([
      { id: "opt_1", narrative: "a" },
      { id: "opt_1", narrative: "b" },
    ]);
    expect(parseAIOptimizationResponse(duplicated, ["opt_1"])).toBeNull();
  });

  it("returns null when narrative exceeds the max length (500 chars)", () => {
    const tooLong = JSON.stringify([{ id: "opt_1", narrative: "x".repeat(501) }]);
    expect(parseAIOptimizationResponse(tooLong, ["opt_1"])).toBeNull();
  });

  it("returns null when narrative is empty", () => {
    const empty = JSON.stringify([{ id: "opt_1", narrative: "" }]);
    expect(parseAIOptimizationResponse(empty, ["opt_1"])).toBeNull();
  });

  it("strips extra fields rather than rejecting them (z.object, not .strict())", () => {
    const withExtra = JSON.stringify([{ id: "opt_1", narrative: "real", actionType: "SOMETHING_ROGUE" }]);
    const result = parseAIOptimizationResponse(withExtra, ["opt_1"]);
    expect(result).not.toBeNull();
    expect(result?.[0]).not.toHaveProperty("actionType");
  });

  it("returns null for an empty array response when ids were requested", () => {
    expect(parseAIOptimizationResponse("[]", ["opt_1"])).toBeNull();
  });

  it("returns null when the top-level JSON is not an array", () => {
    expect(parseAIOptimizationResponse(JSON.stringify({ id: "opt_1", narrative: "x" }), ["opt_1"])).toBeNull();
  });
});

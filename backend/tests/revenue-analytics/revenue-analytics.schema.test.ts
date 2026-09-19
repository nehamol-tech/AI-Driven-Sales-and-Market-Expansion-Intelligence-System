import { describe, it, expect } from "vitest";
import { parseAIRevenueNarrative } from "../../src/modules/revenue-analytics/revenue-analytics.schema.js";

describe("parseAIRevenueNarrative", () => {
  it("accepts a valid JSON object", () => {
    const result = parseAIRevenueNarrative(JSON.stringify({ narrative: "Revenue grew steadily based on this company's own data." }));
    expect(result).toEqual({ narrative: "Revenue grew steadily based on this company's own data." });
  });

  it("accepts markdown-fenced JSON", () => {
    const fenced = "```json\n" + JSON.stringify({ narrative: "A real narrative." }) + "\n```";
    expect(parseAIRevenueNarrative(fenced)).toEqual({ narrative: "A real narrative." });
  });

  it("returns null for malformed (non-JSON) content", () => {
    expect(parseAIRevenueNarrative("this is not json at all")).toBeNull();
  });

  it("returns null when the narrative field is missing", () => {
    expect(parseAIRevenueNarrative(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("returns null for an empty-string narrative", () => {
    expect(parseAIRevenueNarrative(JSON.stringify({ narrative: "" }))).toBeNull();
  });

  it("returns null for a narrative over 800 characters", () => {
    const tooLong = "x".repeat(801);
    expect(parseAIRevenueNarrative(JSON.stringify({ narrative: tooLong }))).toBeNull();
  });

  it("accepts a narrative at exactly 800 characters", () => {
    const exact = "x".repeat(800);
    expect(parseAIRevenueNarrative(JSON.stringify({ narrative: exact }))).toEqual({ narrative: exact });
  });

  it("strips extra fields rather than rejecting the entry", () => {
    const result = parseAIRevenueNarrative(JSON.stringify({ narrative: "x", forecast: [9999], growthRatePercent: 500 }));
    expect(result).toEqual({ narrative: "x" });
  });
});

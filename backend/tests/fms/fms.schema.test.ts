import { describe, it, expect } from "vitest";
import { fmsDataQuerySchema } from "../../src/modules/fms/fms.schema.js";

describe("fmsDataQuerySchema", () => {
  it("accepts an empty query (both params are optional)", () => {
    const result = fmsDataQuerySchema.parse({});
    expect(result.sheet).toBeUndefined();
    expect(result.limit).toBeUndefined();
  });

  it("accepts a valid sheet + limit", () => {
    const result = fmsDataQuerySchema.parse({ sheet: "FMS", limit: "10" });
    expect(result.sheet).toBe("FMS");
    expect(result.limit).toBe(10);
  });

  it("coerces a numeric-string limit to a number", () => {
    expect(fmsDataQuerySchema.parse({ limit: "25" }).limit).toBe(25);
  });

  it("rejects an empty-string sheet", () => {
    expect(() => fmsDataQuerySchema.parse({ sheet: "" })).toThrow();
  });

  it("rejects a non-integer limit", () => {
    expect(() => fmsDataQuerySchema.parse({ limit: "1.5" })).toThrow();
  });

  it("rejects a zero or negative limit", () => {
    expect(() => fmsDataQuerySchema.parse({ limit: "0" })).toThrow();
    expect(() => fmsDataQuerySchema.parse({ limit: "-5" })).toThrow();
  });

  it("rejects a limit above the 1000 cap", () => {
    expect(() => fmsDataQuerySchema.parse({ limit: "1001" })).toThrow();
  });

  it("accepts the limit exactly at the 1000 cap", () => {
    expect(fmsDataQuerySchema.parse({ limit: "1000" }).limit).toBe(1000);
  });
});

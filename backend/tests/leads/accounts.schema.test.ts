import { describe, it, expect } from "vitest";
import { listAccountsQuerySchema, triggerScoreSchema } from "../../src/modules/leads/accounts.schema.js";

describe("listAccountsQuerySchema", () => {
  it("applies default pagination", () => {
    const result = listAccountsQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("accepts a valid classification filter", () => {
    const result = listAccountsQuerySchema.parse({ classification: "HOT" });
    expect(result.classification).toBe("HOT");
  });

  it("rejects an invalid classification value", () => {
    expect(() => listAccountsQuerySchema.parse({ classification: "BURNING" })).toThrow();
  });

  it("coerces hasScore query string to boolean", () => {
    expect(listAccountsQuerySchema.parse({ hasScore: "true" }).hasScore).toBe(true);
    expect(listAccountsQuerySchema.parse({ hasScore: "false" }).hasScore).toBe(false);
  });

  it("coerces minScore to a number and rejects out-of-range values", () => {
    expect(listAccountsQuerySchema.parse({ minScore: "50" }).minScore).toBe(50);
    expect(() => listAccountsQuerySchema.parse({ minScore: "101" })).toThrow();
  });
});

describe("triggerScoreSchema", () => {
  it("defaults force to false", () => {
    expect(triggerScoreSchema.parse({}).force).toBe(false);
  });

  it("accepts force: true", () => {
    expect(triggerScoreSchema.parse({ force: true }).force).toBe(true);
  });
});

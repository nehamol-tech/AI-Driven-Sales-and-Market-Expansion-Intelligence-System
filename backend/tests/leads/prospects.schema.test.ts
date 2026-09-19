import { describe, it, expect } from "vitest";
import { createProspectSchema, updateProspectSchema, listProspectsQuerySchema } from "../../src/modules/leads/prospects.schema.js";

describe("createProspectSchema", () => {
  it("accepts a minimal valid payload and applies defaults", () => {
    const result = createProspectSchema.parse({ businessName: "Beta Traders" });
    expect(result.status).toBe("NEW");
    expect(result.productIds).toEqual([]);
    expect(result.industryId).toBeUndefined();
  });

  it("rejects a payload missing businessName", () => {
    expect(() => createProspectSchema.parse({})).toThrow();
  });

  it("rejects an invalid contactEmail", () => {
    expect(() => createProspectSchema.parse({ businessName: "Beta", contactEmail: "not-an-email" })).toThrow();
  });

  it("treats an empty-string contactEmail as null rather than an invalid email", () => {
    const result = createProspectSchema.parse({ businessName: "Beta", contactEmail: "" });
    expect(result.contactEmail).toBeNull();
  });

  it("rejects an invalid status value", () => {
    expect(() => createProspectSchema.parse({ businessName: "Beta", status: "SUPER_HOT" })).toThrow();
  });

  it("accepts a full payload with industry/state/city/products", () => {
    const result = createProspectSchema.parse({
      businessName: "Beta Traders",
      industryId: "ind_1",
      stateId: "state_1",
      cityId: "city_1",
      status: "CONTACTED",
      productIds: ["prod_1", "prod_2"],
    });
    expect(result.industryId).toBe("ind_1");
    expect(result.productIds).toEqual(["prod_1", "prod_2"]);
  });
});

describe("updateProspectSchema", () => {
  it("accepts a partial payload with only status", () => {
    const result = updateProspectSchema.parse({ status: "QUALIFIED" });
    expect(result).toEqual({ status: "QUALIFIED" });
  });
});

describe("listProspectsQuerySchema", () => {
  it("applies default pagination", () => {
    const result = listProspectsQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("rejects an invalid status filter", () => {
    expect(() => listProspectsQuerySchema.parse({ status: "MAYBE" })).toThrow();
  });
});

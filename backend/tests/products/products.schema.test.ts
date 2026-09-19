import { describe, it, expect } from "vitest";
import { createProductSchema, updateProductSchema, listProductsQuerySchema } from "../../src/modules/products/products.schema.js";

describe("createProductSchema", () => {
  it("accepts a valid product payload and applies defaults", () => {
    const result = createProductSchema.parse({
      name: "Widget Pro",
      sku: "WP-100",
      price: "199.99",
    });
    expect(result.minOrderQty).toBe(1);
    expect(result.availableQty).toBe(0);
    expect(result.isActive).toBe(true);
    expect(result.keywords).toEqual([]);
    expect(result.targetIndustryIds).toEqual([]);
  });

  it("rejects a payload missing a required name", () => {
    expect(() => createProductSchema.parse({ sku: "WP-100", price: "199.99" })).toThrow();
  });

  it("rejects a payload missing a required sku", () => {
    expect(() => createProductSchema.parse({ name: "Widget Pro", price: "199.99" })).toThrow();
  });

  it("rejects an invalid price format", () => {
    expect(() => createProductSchema.parse({ name: "Widget Pro", sku: "WP-100", price: "not-a-number" })).toThrow();
  });

  it("rejects a price with more than 2 decimal places", () => {
    expect(() => createProductSchema.parse({ name: "Widget Pro", sku: "WP-100", price: "10.999" })).toThrow();
  });

  it("rejects a negative or zero minOrderQty", () => {
    expect(() =>
      createProductSchema.parse({ name: "Widget Pro", sku: "WP-100", price: "10.00", minOrderQty: 0 }),
    ).toThrow();
  });

  it("rejects a negative availableQty", () => {
    expect(() =>
      createProductSchema.parse({ name: "Widget Pro", sku: "WP-100", price: "10.00", availableQty: -5 }),
    ).toThrow();
  });
});

describe("updateProductSchema", () => {
  it("accepts a partial payload with only some fields", () => {
    const result = updateProductSchema.parse({ isActive: false });
    expect(result).toEqual({ isActive: false });
  });

  it("rejects an invalid price if provided", () => {
    expect(() => updateProductSchema.parse({ price: "abc" })).toThrow();
  });
});

describe("listProductsQuerySchema", () => {
  it("applies default pagination", () => {
    const result = listProductsQuerySchema.parse({});
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it("coerces isActive query string to boolean", () => {
    const result = listProductsQuerySchema.parse({ isActive: "true" });
    expect(result.isActive).toBe(true);
  });

  it("rejects a pageSize above the max", () => {
    expect(() => listProductsQuerySchema.parse({ pageSize: "1000" })).toThrow();
  });
});

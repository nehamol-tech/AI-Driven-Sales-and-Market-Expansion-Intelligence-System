import { describe, it, expect } from "vitest";
import {
  parseCsvContent,
  normalizeSalesCsvRow,
  type SalesImportLookups,
} from "../../src/modules/sales/sales-import.util.js";

function buildLookups(): SalesImportLookups {
  return {
    statesByName: new Map([
      ["karnataka", { id: "state_ka", name: "Karnataka" }],
      ["maharashtra", { id: "state_mh", name: "Maharashtra" }],
    ]),
    citiesByStateIdAndName: new Map([["state_ka|bengaluru", { id: "city_blr", name: "Bengaluru" }]]),
    productsByNameOrSku: new Map([["widget pro", { id: "prod_1", name: "Widget Pro" }], ["wp-100", { id: "prod_1", name: "Widget Pro" }]]),
    industriesByName: new Map([["it & software services", { id: "ind_1", name: "IT & Software Services" }]]),
    usersByEmailOrName: new Map([["sales@example.com", { id: "user_1", name: "Jane Sales" }]]),
  };
}

const CSV_CONTENT = `date,product,customer,state,city,industry,quantity,orderValue,salesperson,isNewCustomer
2026-01-15,Widget Pro,Acme Corp,Karnataka,Bengaluru,IT & Software Services,10,5000,sales@example.com,true
2026-01-16,Unknown Widget,Beta Inc,Karnataka,Bengaluru,IT & Software Services,5,1000,sales@example.com,false
2026-01-17,Widget Pro,Gamma LLC,Unknown State,,,3,750,sales@example.com,false
2026-01-18,Widget Pro,Delta Co,,,,2,500,,false
`;

describe("parseCsvContent", () => {
  it("parses CSV content into row objects keyed by lowercase header", () => {
    const rows = parseCsvContent(CSV_CONTENT);
    expect(rows).toHaveLength(4);
    expect(rows[0].customer).toBe("Acme Corp");
    expect(rows[0].quantity).toBe("10");
  });
});

describe("normalizeSalesCsvRow", () => {
  const lookups = buildLookups();

  it("successfully normalizes a row where every reference matches", () => {
    const rows = parseCsvContent(CSV_CONTENT);
    const result = normalizeSalesCsvRow(rows[0], 2, lookups);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.customerName).toBe("Acme Corp");
      expect(result.data.stateId).toBe("state_ka");
      expect(result.data.cityId).toBe("city_blr");
      expect(result.data.industryId).toBe("ind_1");
      expect(result.data.productId).toBe("prod_1");
      expect(result.data.salespersonId).toBe("user_1");
      expect(result.data.quantity).toBe(10);
      expect(result.data.orderValue).toBe("5000.00");
      expect(result.data.isNewCustomer).toBe(true);
    }
  });

  it("fails a row that references a product not found in the lookup", () => {
    const rows = parseCsvContent(CSV_CONTENT);
    const result = normalizeSalesCsvRow(rows[1], 3, lookups);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.row).toBe(3);
      expect(result.message).toMatch(/product not found/i);
    }
  });

  it("fails a row that references a state not found in the lookup", () => {
    const rows = parseCsvContent(CSV_CONTENT);
    const result = normalizeSalesCsvRow(rows[2], 4, lookups);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/state not found/i);
    }
  });

  it("accepts a row with no state/city/product/industry/salesperson given, leaving them null", () => {
    const rows = parseCsvContent(CSV_CONTENT);
    const result = normalizeSalesCsvRow(rows[3], 5, lookups);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stateId).toBeNull();
      expect(result.data.cityId).toBeNull();
      expect(result.data.industryId).toBeNull();
      expect(result.data.salespersonId).toBeNull();
    }
  });

  it("fails a row missing a required field (customer)", () => {
    const result = normalizeSalesCsvRow(
      { date: "2026-01-01", customer: "", quantity: "1", ordervalue: "10" },
      2,
      lookups,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/customer/i);
    }
  });

  it("fails a row with an invalid quantity", () => {
    const result = normalizeSalesCsvRow(
      { date: "2026-01-01", customer: "Acme", quantity: "abc", ordervalue: "10" },
      2,
      lookups,
    );
    expect(result.success).toBe(false);
  });

  it("fails a city given without a resolvable state", () => {
    const result = normalizeSalesCsvRow(
      { date: "2026-01-01", customer: "Acme", quantity: "1", ordervalue: "10", city: "Bengaluru" },
      2,
      lookups,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toMatch(/city/i);
    }
  });
});

import { describe, it, expect } from "vitest";
import { normalizeFmsOrderRow, buildReconciliationKey, cancelledFmsRowExternalRef, diffFmsRecord, fmsRowExternalRef } from "../../src/modules/fms/fms-order-sync.util.js";

/** A real row, captured live from "FMS Response" (Phase 3B) — note the different labels: "Product & Qty" (not "and"), "PDC Cheque" (no "Date"), plus two near-empty trailing columns this sheet has that "Form responses 2" doesn't. */
const REAL_FMS_RESPONSE_ROW = {
  "टाइमस्टैम्प": "2026-04-01 11:38:21",
  "Bill No.": 1,
  "Customer Name": "Krishna Mill Stores",
  "Product & Qty": "R (3.15) - 21 Box\nC (0.80) - 11\nC (1.20) - 11",
  "Bill Amount": 95391,
  "Order Taken": "Aditya",
  "Dispatched By": "Suresh",
  "Dispatched Date": "2026-04-01 00:00:00",
  "PDC Cheque": "",
  "कॉलम 9": "",
  "Column 9": "",
};

/** A real row, captured live from "Form responses 2" — multi-line Product and Qty, on purpose. */
const REAL_ROW = {
  "टाइमस्टैम्प": "2026-04-01 11:38:21",
  "Bill No.": 1,
  "Customer Name": "Krishna Mill Stores",
  "Product and Qty": "R (3.15) - 21 Box\nC (0.80) - 11\nC (1.20) - 11",
  "Order Taken": "Aditya",
  "Dispatched By": "Ram",
  "Dispatched Date": "2026-04-01 00:00:00",
  "PDC Cheque Date": "",
  "Bill Amount": 95391,
};

describe("normalizeFmsOrderRow", () => {
  it("extracts customerName/orderValue/date/externalRef, and nothing else at the top level", () => {
    const result = normalizeFmsOrderRow(REAL_ROW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.customerName).toBe("Krishna Mill Stores");
    expect(result.data.orderValue).toBe("95391.00");
    expect(result.data.date.toISOString()).toBe(new Date("2026-04-01 00:00:00").toISOString());
    expect(result.data.externalRef).toBe("1|2026-04-01 11:38:21");
    expect(Object.keys(result.data).sort()).toEqual(["customerName", "date", "externalRef", "metadata", "orderValue"].sort());
  });

  it("1/2. stores complete metadata, preserving the full raw Product and Qty string exactly", () => {
    const result = normalizeFmsOrderRow(REAL_ROW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metadata).toEqual({
      fms: {
        billNo: "1",
        timestamp: "2026-04-01 11:38:21",
        customerName: "Krishna Mill Stores",
        productAndQty: "R (3.15) - 21 Box\nC (0.80) - 11\nC (1.20) - 11",
        orderTaken: "Aditya",
        dispatchedBy: "Ram",
        dispatchedDate: "2026-04-01 00:00:00",
        pdcChequeDate: "",
        billAmount: "95391",
      },
    });
  });

  it("2. preserves an unusual/irregular Product and Qty string byte-for-byte, however it's shaped", () => {
    const weird = "C (0.80) (12.5) NW70 - 5";
    const result = normalizeFmsOrderRow({ ...REAL_ROW, "Product and Qty": weird });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metadata.fms.productAndQty).toBe(weird);
    // Confirms it's stored, not interpreted: no other field is affected by its content.
    expect(result.data.externalRef).toBe("1|2026-04-01 11:38:21");
    expect(result.data.orderValue).toBe("95391.00");
  });

  it("3. Bill No. is preserved in metadata and used verbatim (as a string) in externalRef", () => {
    const result = normalizeFmsOrderRow({ ...REAL_ROW, "Bill No.": 42 });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metadata.fms.billNo).toBe("42");
    expect(result.data.externalRef).toBe("42|2026-04-01 11:38:21");
  });

  it("4. टाइमस्टैम्प (timestamp) is preserved in metadata and used verbatim in externalRef", () => {
    const result = normalizeFmsOrderRow({ ...REAL_ROW, "टाइमस्टैम्प": "2026-04-01 13:53:10" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metadata.fms.timestamp).toBe("2026-04-01 13:53:10");
    expect(result.data.externalRef).toBe("1|2026-04-01 13:53:10");
  });

  it("5. Order Taken is preserved in metadata unmodified", () => {
    const result = normalizeFmsOrderRow({ ...REAL_ROW, "Order Taken": "Direct" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metadata.fms.orderTaken).toBe("Direct");
  });

  it("6. Dispatched By is preserved in metadata unmodified", () => {
    const result = normalizeFmsOrderRow({ ...REAL_ROW, "Dispatched By": "Suresh" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metadata.fms.dispatchedBy).toBe("Suresh");
  });

  it("7. PDC Cheque Date is preserved in metadata, including when blank", () => {
    const blank = normalizeFmsOrderRow({ ...REAL_ROW, "PDC Cheque Date": "" });
    const filled = normalizeFmsOrderRow({ ...REAL_ROW, "PDC Cheque Date": "2026-05-01" });
    expect(blank.success && blank.data.metadata.fms.pdcChequeDate).toBe("");
    expect(filled.success && filled.data.metadata.fms.pdcChequeDate).toBe("2026-05-01");
  });

  it("8. externalRef is deterministic — same Bill No. + timestamp always produces the same value", () => {
    const a = normalizeFmsOrderRow(REAL_ROW);
    const b = normalizeFmsOrderRow({ ...REAL_ROW, "Customer Name": "A Totally Different Customer", "Bill Amount": 1 });
    expect(a.success && a.data.externalRef).toBe(b.success && b.data.externalRef);
  });

  it("10. a different Bill No. or timestamp produces a different externalRef", () => {
    const base = normalizeFmsOrderRow(REAL_ROW);
    const differentBillNo = normalizeFmsOrderRow({ ...REAL_ROW, "Bill No.": 2 });
    const differentTimestamp = normalizeFmsOrderRow({ ...REAL_ROW, "टाइमस्टैम्प": "2026-04-01 11:39:30" });
    expect(base.success && base.data.externalRef).not.toBe(differentBillNo.success && differentBillNo.data.externalRef);
    expect(base.success && base.data.externalRef).not.toBe(differentTimestamp.success && differentTimestamp.data.externalRef);
  });

  it("handles Bill Amount arriving as a JSON number (observed live) the same as a numeric string", () => {
    const asNumber = normalizeFmsOrderRow({ ...REAL_ROW, "Bill Amount": 95391 });
    const asString = normalizeFmsOrderRow({ ...REAL_ROW, "Bill Amount": "95391" });
    expect(asNumber).toEqual(asString);
  });

  it("fails on a missing Bill No. (needed for externalRef)", () => {
    const row = { ...REAL_ROW, "Bill No.": "" };
    const result = normalizeFmsOrderRow(row);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toContain("Bill No.");
  });

  it("fails on a missing टाइमस्टैम्प (needed for externalRef)", () => {
    const row = { ...REAL_ROW, "टाइमस्टैम्प": "" };
    const result = normalizeFmsOrderRow(row);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toContain("टाइमस्टैम्प");
  });

  it("fails on a missing Customer Name", () => {
    const row = { ...REAL_ROW, "Customer Name": "" };
    const result = normalizeFmsOrderRow(row);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toContain("Customer Name");
  });

  it("fails on a missing Bill Amount", () => {
    const row = { ...REAL_ROW };
    delete (row as Record<string, unknown>)["Bill Amount"];
    const result = normalizeFmsOrderRow(row);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toContain("Bill Amount");
  });

  it("fails on a negative Bill Amount", () => {
    const result = normalizeFmsOrderRow({ ...REAL_ROW, "Bill Amount": -100 });
    expect(result.success).toBe(false);
  });

  it("fails on a non-numeric Bill Amount", () => {
    const result = normalizeFmsOrderRow({ ...REAL_ROW, "Bill Amount": "not a number" });
    expect(result.success).toBe(false);
  });

  it("fails on a missing Dispatched Date", () => {
    const row = { ...REAL_ROW, "Dispatched Date": "" };
    const result = normalizeFmsOrderRow(row);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.message).toContain("Dispatched Date");
  });

  it("fails on an unparseable Dispatched Date", () => {
    const result = normalizeFmsOrderRow({ ...REAL_ROW, "Dispatched Date": "not a date" });
    expect(result.success).toBe(false);
  });
});

describe("normalizeFmsOrderRow — 'FMS Response' sheet's different column labels", () => {
  it("reads 'Product & Qty' (not 'Product and Qty') correctly, verbatim", () => {
    const result = normalizeFmsOrderRow(REAL_FMS_RESPONSE_ROW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metadata.fms.productAndQty).toBe("R (3.15) - 21 Box\nC (0.80) - 11\nC (1.20) - 11");
  });

  it("reads 'PDC Cheque' (not 'PDC Cheque Date') correctly", () => {
    const result = normalizeFmsOrderRow({ ...REAL_FMS_RESPONSE_ROW, "PDC Cheque": "2026-05-01" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.metadata.fms.pdcChequeDate).toBe("2026-05-01");
  });

  it("ignores the two extra trailing columns ('कॉलम 9', 'Column 9') this sheet has", () => {
    const result = normalizeFmsOrderRow(REAL_FMS_RESPONSE_ROW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(JSON.stringify(result.data.metadata)).not.toContain("कॉलम 9");
  });

  it("still extracts customerName/orderValue/date/externalRef correctly from FMS Response's column order", () => {
    const result = normalizeFmsOrderRow(REAL_FMS_RESPONSE_ROW);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.customerName).toBe("Krishna Mill Stores");
    expect(result.data.orderValue).toBe("95391.00");
    expect(result.data.externalRef).toBe("1|2026-04-01 11:38:21");
  });
});

describe("buildReconciliationKey", () => {
  it("8. is deterministic — same inputs always produce the same key", () => {
    const a = buildReconciliationKey({ billNo: "1", billAmount: "95391", productAndQty: "R (3.15) - 21 Box" });
    const b = buildReconciliationKey({ billNo: "1", billAmount: "95391", productAndQty: "R (3.15) - 21 Box" });
    expect(a).toBe(b);
  });

  it("trims each input, matching the Phase 3C-validated methodology", () => {
    const a = buildReconciliationKey({ billNo: " 1 ", billAmount: " 95391 ", productAndQty: " R (3.15) - 21 Box " });
    const b = buildReconciliationKey({ billNo: "1", billAmount: "95391", productAndQty: "R (3.15) - 21 Box" });
    expect(a).toBe(b);
  });

  it("is independent of the row's timestamp, customer name, Order Taken, or Dispatched By", () => {
    const rowA = normalizeFmsOrderRow(REAL_ROW); // Dispatched By: "Ram", टाइमस्टैम्प 11:38:21
    const rowB = normalizeFmsOrderRow({ ...REAL_ROW, "टाइमस्टैम्प": "2026-04-01 11:39:00", "Dispatched By": "Suresh", "Order Taken": "Direct" });
    expect(rowA.success && rowB.success).toBe(true);
    if (!rowA.success || !rowB.success) return;
    const keyA = buildReconciliationKey({
      billNo: rowA.data.metadata.fms.billNo,
      billAmount: rowA.data.metadata.fms.billAmount,
      productAndQty: rowA.data.metadata.fms.productAndQty,
    });
    const keyB = buildReconciliationKey({
      billNo: rowB.data.metadata.fms.billNo,
      billAmount: rowB.data.metadata.fms.billAmount,
      productAndQty: rowB.data.metadata.fms.productAndQty,
    });
    expect(keyA).toBe(keyB); // same order, same reconciliation key, despite the drift/name differences
  });

  it("a different Bill Amount or Product & Qty produces a different key", () => {
    const base = buildReconciliationKey({ billNo: "1", billAmount: "95391", productAndQty: "R (3.15) - 21 Box" });
    const differentAmount = buildReconciliationKey({ billNo: "1", billAmount: "999", productAndQty: "R (3.15) - 21 Box" });
    const differentProduct = buildReconciliationKey({ billNo: "1", billAmount: "95391", productAndQty: "Something else" });
    expect(base).not.toBe(differentAmount);
    expect(base).not.toBe(differentProduct);
  });
});

describe("cancelledFmsRowExternalRef", () => {
  const row = (overrides: Record<string, unknown>) =>
    ({ "टाइमस्टैम्प": "2026-09-24 12:57:36", "Bill No.": 2885, "Customer Name": "CANCELLED", "Bill Amount": "", ...overrides }) as never;

  it("returns the imported externalRef for Customer Name CANCELLED with a blank Bill Amount", () => {
    expect(cancelledFmsRowExternalRef(row({}))).toBe("2885|2026-09-24 12:57:36");
    expect(cancelledFmsRowExternalRef(row({ "Customer Name": "  cancelled ", "Bill Amount": "  " }))).toBe("2885|2026-09-24 12:57:36");
  });

  it("is not a cancellation when the Bill Amount is present, the name differs, or the bill can't be identified", () => {
    expect(cancelledFmsRowExternalRef(row({ "Bill Amount": 14190 }))).toBeNull();
    expect(cancelledFmsRowExternalRef(row({ "Customer Name": "Cancelled Traders" }))).toBeNull();
    expect(cancelledFmsRowExternalRef(row({ "Bill No.": "" }))).toBeNull();
    expect(cancelledFmsRowExternalRef(row({ "टाइमस्टैम्प": "" }))).toBeNull();
  });
});

describe("diffFmsRecord / fmsRowExternalRef", () => {
  const base = {
    customerName: "Acme",
    orderValue: "100.00",
    date: new Date("2026-04-01 00:00:00"),
    metadata: { fms: { billNo: "1", orderTaken: "Ravi", billAmount: "100" } },
  };

  it("finds no change for identical values, comparing money to the cent", () => {
    expect(diffFmsRecord(base, { ...base, orderValue: 100 })).toEqual([]);
  });

  it("names exactly the fields that changed", () => {
    const next = { ...base, customerName: "Acme Ltd", date: new Date("2026-04-02 00:00:00"), metadata: { fms: { billNo: "1", orderTaken: "Priya", billAmount: "100" } } };
    expect(diffFmsRecord(base, next)).toEqual(["customerName", "date", "metadata.orderTaken"]);
  });

  it("builds a row's identity whether or not the row is otherwise valid", () => {
    expect(fmsRowExternalRef({ "Bill No.": 7, "टाइमस्टैम्प": "2026-05-01 09:00:00" } as never)).toBe("7|2026-05-01 09:00:00");
    expect(fmsRowExternalRef({ "Bill No.": 7 } as never)).toBeNull();
  });
});

describe("diffFmsRecord — stored JSON", () => {
  it("treats metadata objects with reordered keys (as Postgres JSONB returns them) as unchanged", () => {
    const stored = { customerName: "A", orderValue: "0.00", date: new Date(0), metadata: { fms: { billNo: "1", adjustments: [{ amount: "-5.00", timestamp: "t" }], netAmount: "0.00" } } };
    const incoming = { ...stored, metadata: { fms: { billNo: "1", adjustments: [{ timestamp: "t", amount: "-5.00" }], netAmount: "0.00" } } };
    expect(diffFmsRecord(stored, incoming)).toEqual([]);
    const changed = { ...stored, metadata: { fms: { billNo: "1", adjustments: [{ timestamp: "t", amount: "-6.00" }], netAmount: "0.00" } } };
    expect(diffFmsRecord(stored, changed)).toEqual(["metadata.adjustments"]);
  });
});

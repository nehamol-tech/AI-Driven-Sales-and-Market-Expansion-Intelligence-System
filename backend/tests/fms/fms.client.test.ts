import { describe, it, expect } from "vitest";
import { parseFmsApiResponse } from "../../src/modules/fms/fms.client.js";

/**
 * Captured live from the real FMS Apps Script endpoint
 * (?sheet=FMS&limit=3) — deliberately NOT cleaned up, so this fixture
 * documents exactly how unreliable the real column headers are: a bare row
 * number, a stringified JS Date, a decimal day-fraction, "Column_N"
 * placeholders, and workflow step labels, all as literal object keys.
 */
const REAL_FMS_SUCCESS_FIXTURE = {
  success: true,
  sheet: "FMS",
  count: 3,
  totalRows: 998,
  data: [
    {
      "19": "",
      "Thu Sep 17 2026 11:27:10 GMT+0530 (India Standard Time)": "",
      "0.41666666666666663": "",
      "Mon Jan 08 1900 00:00:00 GMT+0521 (India Standard Time)": "",
      "0000001": "",
      Column_6: "",
      step1: "step1",
      step5: "step5",
    },
    {
      "19": "",
      "Thu Sep 17 2026 11:27:10 GMT+0530 (India Standard Time)": " ",
      "0.41666666666666663": "Taking Order",
      Column_8: "Billing and Rechecking",
      Column_13: "Material Shuffling / Loading",
    },
  ],
};

/** Also captured live: an unrecognized `sheet` query param. */
const REAL_FMS_ERROR_FIXTURE = {
  success: false,
  error: "Sheet not allowed",
  allowedSheets: ["FMS", "DB_Format", "Form responses 2", "Data", "Steps Directory", "Doer Emails"],
};

describe("parseFmsApiResponse", () => {
  it("parses a real success response and preserves every raw row key exactly, unrenamed", () => {
    const result = parseFmsApiResponse(REAL_FMS_SUCCESS_FIXTURE);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.body.sheet).toBe("FMS");
    expect(result.body.count).toBe(3);
    expect(result.body.totalRows).toBe(998);
    expect(result.body.data).toHaveLength(2);
    expect(result.body.data[0]).toEqual(REAL_FMS_SUCCESS_FIXTURE.data[0]);
    expect(result.body.data[1]["Column_8"]).toBe("Billing and Rechecking");
  });

  it("parses a real upstream-rejected response (bad sheet name)", () => {
    const result = parseFmsApiResponse(REAL_FMS_ERROR_FIXTURE);
    expect(result).toEqual({
      status: "upstream_rejected",
      error: "Sheet not allowed",
      allowedSheets: ["FMS", "DB_Format", "Form responses 2", "Data", "Steps Directory", "Doer Emails"],
    });
  });

  it("treats success:false with no 'error' string as a generic upstream_rejected, never crashes", () => {
    const result = parseFmsApiResponse({ success: false });
    expect(result).toEqual({ status: "upstream_rejected", error: "Unknown upstream error", allowedSheets: null });
  });

  it("returns malformed_response for a non-object body", () => {
    expect(parseFmsApiResponse("not json").status).toBe("malformed_response");
    expect(parseFmsApiResponse(null).status).toBe("malformed_response");
    expect(parseFmsApiResponse([1, 2, 3]).status).toBe("malformed_response");
  });

  it("returns malformed_response when 'success' is missing entirely", () => {
    expect(parseFmsApiResponse({ sheet: "FMS", data: [] }).status).toBe("malformed_response");
  });

  it("returns malformed_response when 'sheet' is not a string", () => {
    expect(parseFmsApiResponse({ success: true, sheet: 123, count: 1, totalRows: 1, data: [] }).status).toBe("malformed_response");
  });

  it("returns malformed_response when 'count'/'totalRows' are not numbers", () => {
    expect(parseFmsApiResponse({ success: true, sheet: "FMS", count: "3", totalRows: 998, data: [] }).status).toBe("malformed_response");
  });

  it("returns malformed_response when 'data' is missing or not an array", () => {
    expect(parseFmsApiResponse({ success: true, sheet: "FMS", count: 0, totalRows: 0 }).status).toBe("malformed_response");
    expect(parseFmsApiResponse({ success: true, sheet: "FMS", count: 0, totalRows: 0, data: "oops" }).status).toBe("malformed_response");
  });

  it("returns malformed_response when a row in 'data' is not a plain object", () => {
    const result = parseFmsApiResponse({ success: true, sheet: "FMS", count: 1, totalRows: 1, data: ["not an object"] });
    expect(result.status).toBe("malformed_response");
  });

  it("accepts an empty data array (zero rows is a valid real outcome, not an error)", () => {
    const result = parseFmsApiResponse({ success: true, sheet: "FMS", count: 0, totalRows: 998, data: [] });
    expect(result).toEqual({ status: "ok", body: { success: true, sheet: "FMS", count: 0, totalRows: 998, data: [] } });
  });
});

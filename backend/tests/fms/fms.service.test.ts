import { describe, it, expect, vi } from "vitest";
import { getFmsData } from "../../src/modules/fms/fms.service.js";
import type { FetchFmsDataResult, FmsClient } from "../../src/modules/fms/fms.client.js";

function makeFakeClient(result: FetchFmsDataResult): FmsClient {
  return { fetchData: vi.fn(async () => result) };
}

describe("getFmsData", () => {
  it("maps a successful client fetch to a configured:true DTO, tagged EXTERNAL_DATA, preserving rows exactly", async () => {
    const client = makeFakeClient({
      status: "ok",
      body: { success: true, sheet: "FMS", count: 2, totalRows: 998, data: [{ step1: "step1" }, { Column_8: "Billing and Rechecking" }] },
    });

    const result = await getFmsData(client, { sheet: "FMS", limit: 2 });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.dto).toMatchObject({
      configured: true,
      sheet: "FMS",
      count: 2,
      totalRows: 998,
      dataSourceType: "EXTERNAL_DATA",
      data: [{ step1: "step1" }, { Column_8: "Billing and Rechecking" }],
    });
    expect(typeof result.dto.fetchedAt).toBe("string");
    expect(new Date(result.dto.fetchedAt).toString()).not.toBe("Invalid Date");
  });

  it("passes sheet/limit params through to the client unchanged", async () => {
    const client = makeFakeClient({ status: "ok", body: { success: true, sheet: "Data", count: 0, totalRows: 0, data: [] } });
    await getFmsData(client, { sheet: "Data", limit: 50 });
    expect(client.fetchData).toHaveBeenCalledWith({ sheet: "Data", limit: 50 });
  });

  it("maps upstream_rejected (bad sheet name) to a bad_request result carrying the allowed-sheets list", async () => {
    const client = makeFakeClient({ status: "upstream_rejected", error: "Sheet not allowed", allowedSheets: ["FMS", "Data"] });
    const result = await getFmsData(client, {});
    expect(result).toEqual({ status: "bad_request", error: "Sheet not allowed", allowedSheets: ["FMS", "Data"] });
  });

  it("maps a network_error to an upstream_error result", async () => {
    const client = makeFakeClient({ status: "network_error", message: "fetch failed" });
    const result = await getFmsData(client, {});
    expect(result).toEqual({ status: "upstream_error", message: "fetch failed" });
  });

  it("maps a malformed_response to an upstream_error result", async () => {
    const client = makeFakeClient({ status: "malformed_response", message: "not valid JSON" });
    const result = await getFmsData(client, {});
    expect(result).toEqual({ status: "upstream_error", message: "not valid JSON" });
  });
});

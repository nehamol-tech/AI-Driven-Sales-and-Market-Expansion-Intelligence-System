import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { FetchFmsDataParams, FetchFmsDataResult, FmsClient } from "../../src/modules/fms/fms.client.js";

/* -------------------------------------------------------------------------
 * HTTP-level test for GET /api/fms/data — the read-only Apps Script proxy.
 * Exercises the real Express app (auth middleware, query validation,
 * controller, error handler) end to end. Prisma is mocked (only the
 * requireAuth user lookup is reachable from this route) and the FMS client
 * factory is mocked with a fake client, so this test performs no network
 * I/O against the real Apps Script and no database reads or writes.
 * ---------------------------------------------------------------------- */

const findUniqueUser = vi.fn();
vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
  },
}));

const fetchData = vi.fn<(params: FetchFmsDataParams) => Promise<FetchFmsDataResult>>();
let fmsConfigured = true;
vi.mock("../../src/modules/fms/fms-client.factory.js", () => ({
  isFmsConfigured: () => fmsConfigured,
  getFmsClient: (): FmsClient | null => (fmsConfigured ? { fetchData } : null),
  getCachedFmsClient: (): FmsClient | null => (fmsConfigured ? { fetchData } : null),
}));

// Imported after the mocks are registered so the app picks up the mocked prisma and FMS client factory.
const { createApp } = await import("../../src/app.js");
const { parseFmsApiResponse } = await import("../../src/modules/fms/fms.client.js");
const { signSessionToken } = await import("../../src/lib/jwt.js");
const { SESSION_COOKIE_NAME } = await import("../../src/config/constants.js");

const app = createApp();

function sessionCookie(role: "ADMIN" | "MANAGER" | "SALES_USER" = "SALES_USER"): string {
  return `${SESSION_COOKIE_NAME}=${signSessionToken({ userId: "u1", role, companyId: "c1" })}`;
}

/** The real "Data" sheet's headers — workflow-step records, not customers/orders. */
const DATA_SHEET_ROWS = [
  { "Unique Key": "K-0001", "Step Code": "S1", "टाइमस्टैम्प": "2026-04-01 11:38:21" },
  { "Unique Key": "K-0002", "Step Code": "S2", "टाइमस्टैम्प": "2026-04-01 12:02:10" },
];

describe("parseFmsApiResponse — current live Apps Script response shape", () => {
  it("accepts the deployed script's extra fetchedAt/readOnly fields without failing validation", () => {
    const parsed = parseFmsApiResponse({
      success: true,
      sheet: "Data",
      count: 2,
      totalRows: 4038,
      data: DATA_SHEET_ROWS,
      fetchedAt: "2026-10-10T11:40:57.293Z",
      readOnly: true,
    });

    expect(parsed.status).toBe("ok");
    if (parsed.status === "ok") expect(parsed.body.data).toEqual(DATA_SHEET_ROWS);
  });
});

describe("GET /api/fms/data", () => {
  beforeEach(() => {
    fmsConfigured = true;
    fetchData.mockReset();
    findUniqueUser.mockReset();
    findUniqueUser.mockResolvedValue({ id: "u1", role: "SALES_USER", companyId: "c1", isActive: true });
  });

  it("returns 401 without a session cookie and never calls the FMS client", async () => {
    const res = await request(app).get("/api/fms/data?sheet=Data&limit=5");
    expect(res.status).toBe(401);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("returns the Data sheet's workflow-step rows exactly as received, with no column renaming", async () => {
    fetchData.mockResolvedValue({
      status: "ok",
      body: { success: true, sheet: "Data", count: 2, totalRows: 4038, data: DATA_SHEET_ROWS },
    });

    const res = await request(app).get("/api/fms/data?sheet=Data&limit=5").set("Cookie", sessionCookie());

    expect(res.status).toBe(200);
    expect(fetchData).toHaveBeenCalledWith({ sheet: "Data", limit: 5 });
    expect(res.body).toMatchObject({
      configured: true,
      sheet: "Data",
      count: 2,
      totalRows: 4038,
      dataSourceType: "EXTERNAL_DATA",
    });
    expect(res.body.data).toEqual(DATA_SHEET_ROWS);
    expect(typeof res.body.fetchedAt).toBe("string");
  });

  it("never exposes the Apps Script URL in the response", async () => {
    fetchData.mockResolvedValue({
      status: "ok",
      body: { success: true, sheet: "Data", count: 2, totalRows: 4038, data: DATA_SHEET_ROWS },
    });

    const res = await request(app).get("/api/fms/data?sheet=Data").set("Cookie", sessionCookie());

    expect(JSON.stringify(res.body)).not.toMatch(/script\.google(usercontent)?\.com/);
  });

  it("returns configured:false (not fabricated rows) when FMS_API_URL is not set", async () => {
    fmsConfigured = false;

    const res = await request(app).get("/api/fms/data?sheet=Data").set("Cookie", sessionCookie());

    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.data).toBeUndefined();
  });

  it("returns 400 with the allowed-sheet list when the Apps Script rejects the sheet name", async () => {
    fetchData.mockResolvedValue({ status: "upstream_rejected", error: "Sheet not allowed", allowedSheets: ["Data", "FMS"] });

    const res = await request(app).get("/api/fms/data?sheet=Nope").set("Cookie", sessionCookie());

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("Sheet not allowed");
    expect(res.body.error.details).toEqual({ allowedSheets: ["Data", "FMS"] });
  });

  it("returns 502 when the Apps Script is unreachable", async () => {
    fetchData.mockResolvedValue({ status: "network_error", message: "FMS API responded with HTTP 500" });

    const res = await request(app).get("/api/fms/data?sheet=Data").set("Cookie", sessionCookie());

    expect(res.status).toBe(502);
    expect(res.body.error.message).toBe("Failed to fetch data from the FMS API");
  });

  it("returns 502 when the Apps Script response is malformed", async () => {
    fetchData.mockResolvedValue({ status: "malformed_response", message: "FMS API response is missing a 'data' array" });

    const res = await request(app).get("/api/fms/data?sheet=Data").set("Cookie", sessionCookie());

    expect(res.status).toBe(502);
  });

  it("rejects an out-of-range limit with 400 before contacting the Apps Script", async () => {
    const res = await request(app).get("/api/fms/data?sheet=Data&limit=5000").set("Cookie", sessionCookie());

    expect(res.status).toBe(400);
    expect(fetchData).not.toHaveBeenCalled();
  });

  it("has no write routes for the sheet itself — POST/PUT/DELETE on /data are 404", async () => {
    for (const method of ["post", "put", "delete"] as const) {
      const res = await request(app)[method]("/api/fms/data").set("Cookie", sessionCookie());
      expect(res.status).toBe(404);
    }
    expect(fetchData).not.toHaveBeenCalled();
  });
});

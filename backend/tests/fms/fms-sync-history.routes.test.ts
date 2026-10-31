import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

/* HTTP-level test for POST /api/fms/sync-history — prisma, the FMS client and the sync runner are mocked. */

const findUniqueUser = vi.fn();
vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => findUniqueUser(...args) },
    auditLog: { create: async () => ({}) },
  },
}));
vi.mock("../../src/modules/fms/fms-client.factory.js", () => ({
  isFmsConfigured: () => true,
  getFmsClient: () => ({ fetchData: vi.fn() }),
  getCachedFmsClient: () => ({ fetchData: vi.fn() }),
  FMS_WARM_REQUESTS: [],
}));
const runFmsHistorySyncExclusive = vi.fn();
vi.mock("../../src/modules/fms/fms-auto-sync.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/modules/fms/fms-auto-sync.js")>();
  return { ...actual, runFmsHistorySyncExclusive: (...args: unknown[]) => runFmsHistorySyncExclusive(...args) };
});

const { createApp } = await import("../../src/app.js");
const { signSessionToken } = await import("../../src/lib/jwt.js");
const { SESSION_COOKIE_NAME } = await import("../../src/config/constants.js");
const { FmsSyncInProgressError } = await import("../../src/modules/fms/fms-auto-sync.js");

const app = createApp();
const cookie = `${SESSION_COOKIE_NAME}=${signSessionToken({ userId: "u1", role: "ADMIN", companyId: "c1" })}`;

describe("POST /api/fms/sync-history", () => {
  beforeEach(() => {
    findUniqueUser.mockResolvedValue({ id: "u1", role: "ADMIN", companyId: "c1", isActive: true });
    runFmsHistorySyncExclusive.mockReset();
  });

  it("runs the sync through the one-at-a-time runner and returns its result", async () => {
    runFmsHistorySyncExclusive.mockResolvedValue({ rowsSynced: 2, rowsUpdated: 1, rowsMarkedCancelled: 0, changes: { inserted: [], updated: [], cancelled: [], missingFromSheet: [] } });
    const res = await request(app).post("/api/fms/sync-history").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, rowsSynced: 2, rowsUpdated: 1 });
    expect(runFmsHistorySyncExclusive).toHaveBeenCalledWith(expect.anything(), "c1", expect.anything());
  });

  it("returns 409 when a sync (e.g. the automatic one) is already running", async () => {
    runFmsHistorySyncExclusive.mockRejectedValue(new FmsSyncInProgressError());
    const res = await request(app).post("/api/fms/sync-history").set("Cookie", cookie);
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("already running");
  });
});

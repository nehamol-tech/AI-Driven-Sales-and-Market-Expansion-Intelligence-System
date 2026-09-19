import { describe, it, expect, vi } from "vitest";
import { NotFoundError } from "../../src/lib/errors.js";
import {
  listDistributors,
  getDistributor,
  createDistributor,
  updateDistributor,
  deleteDistributor,
} from "../../src/modules/distributors/distributors.service.js";
import type { CreateDistributorInput, UpdateDistributorInput } from "../../src/modules/distributors/distributors.schema.js";

function makeFakePrisma(overrides: Record<string, unknown> = {}) {
  const distributorTerritory = {
    deleteMany: vi.fn(async () => ({ count: 0 })),
    createMany: vi.fn(async () => ({ count: 0 })),
  };
  const distributor = {
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    findFirst: vi.fn(async () => null),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "dist_new",
      name: args.data.name,
      type: args.data.type,
      status: args.data.status,
      contactEmail: args.data.contactEmail ?? null,
      contactPhone: args.data.contactPhone ?? null,
      assignedUserId: args.data.assignedUserId ?? null,
      assignedUser: null,
      onboardedAt: args.data.onboardedAt ?? null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      territories: [],
    })),
    update: vi.fn(async (args: { data: Record<string, unknown> }) => ({
      id: "dist_1",
      name: (args.data.name as string) ?? "Existing Distributor",
      type: "DISTRIBUTOR",
      status: "ACTIVE",
      contactEmail: null,
      contactPhone: null,
      assignedUserId: null,
      assignedUser: null,
      onboardedAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      territories: [],
    })),
    delete: vi.fn(async () => ({ id: "dist_1" })),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fake: any = { distributor, distributorTerritory };
  // $transaction reads fake.distributor/fake.distributorTerritory at CALL time (not
  // captured at construction time), so an override applied below is honored inside
  // the transaction callback too — mirrors the real Prisma tx client operating on
  // the same underlying tables as the top-level client.
  fake.$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({ distributor: fake.distributor, distributorTerritory: fake.distributorTerritory }));
  Object.assign(fake, overrides);
  return fake;
}

function makeCreateInput(overrides: Partial<CreateDistributorInput> = {}): CreateDistributorInput {
  return { name: "Acme Distribution", type: "DISTRIBUTOR", status: "PROSPECTIVE", stateIds: [], ...overrides };
}

/* -------------------------------------------------------------------------
 * listDistributors / getDistributor
 * ---------------------------------------------------------------------- */

describe("listDistributors", () => {
  it("passes type/status filters through to the where clause", async () => {
    const fake = makeFakePrisma();
    await listDistributors(fake as never, "c1", { type: "DEALER", status: "ACTIVE", page: 1, pageSize: 20 });
    const call = (fake.distributor.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.where).toMatchObject({ companyId: "c1", type: "DEALER", status: "ACTIVE" });
  });

  it("maps territories/assignedUser into stateIds/stateNames/assignedUserName", async () => {
    const fake = makeFakePrisma({
      distributor: {
        findMany: vi.fn(async () => [
          {
            id: "dist_1",
            name: "Acme Distribution",
            type: "DISTRIBUTOR",
            status: "ACTIVE",
            contactEmail: null,
            contactPhone: null,
            assignedUserId: "u1",
            assignedUser: { name: "Rep One" },
            onboardedAt: null,
            createdAt: new Date("2026-01-01T00:00:00Z"),
            territories: [
              { stateId: "st_1", state: { name: "Kerala" } },
              { stateId: "st_2", state: { name: "Goa" } },
            ],
          },
        ]),
        count: vi.fn(async () => 1),
      },
    });
    const result = await listDistributors(fake as never, "c1", { page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].stateIds).toEqual(["st_1", "st_2"]);
    expect(result.items[0].stateNames).toEqual(["Kerala", "Goa"]);
    expect(result.items[0].assignedUserName).toBe("Rep One");
  });
});

describe("getDistributor", () => {
  it("throws NotFoundError when the distributor doesn't exist or belongs to a different company", async () => {
    const fake = makeFakePrisma();
    await expect(getDistributor(fake as never, "c1", "missing")).rejects.toThrow(NotFoundError);
  });

  it("returns the DTO when found", async () => {
    const fake = makeFakePrisma({
      distributor: {
        findFirst: vi.fn(async () => ({
          id: "dist_1",
          name: "Acme Distribution",
          type: "DISTRIBUTOR",
          status: "ACTIVE",
          contactEmail: null,
          contactPhone: null,
          assignedUserId: null,
          assignedUser: null,
          onboardedAt: null,
          createdAt: new Date("2026-01-01T00:00:00Z"),
          territories: [],
        })),
      },
    });
    const result = await getDistributor(fake as never, "c1", "dist_1");
    expect(result.id).toBe("dist_1");
    expect(result.name).toBe("Acme Distribution");
  });
});

/* -------------------------------------------------------------------------
 * createDistributor
 * ---------------------------------------------------------------------- */

describe("createDistributor", () => {
  it("creates the Distributor row with the given fields and createdById", async () => {
    const fake = makeFakePrisma();
    const result = await createDistributor(fake as never, "c1", "user_1", makeCreateInput());
    const call = (fake.distributor.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data).toMatchObject({ companyId: "c1", name: "Acme Distribution", type: "DISTRIBUTOR", status: "PROSPECTIVE", createdById: "user_1" });
    expect(result.name).toBe("Acme Distribution");
  });

  it("creates DistributorTerritory rows for every given stateId in the same create call", async () => {
    const fake = makeFakePrisma();
    await createDistributor(fake as never, "c1", "user_1", makeCreateInput({ stateIds: ["st_1", "st_2"] }));
    const call = (fake.distributor.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.data.territories).toEqual({ create: [{ stateId: "st_1" }, { stateId: "st_2" }] });
  });
});

/* -------------------------------------------------------------------------
 * updateDistributor — 404 + territory replace-on-update behavior.
 * ---------------------------------------------------------------------- */

describe("updateDistributor", () => {
  it("throws NotFoundError when the distributor doesn't exist or belongs to a different company", async () => {
    const fake = makeFakePrisma();
    const input: UpdateDistributorInput = { name: "New Name" };
    await expect(updateDistributor(fake as never, "c1", "missing", input)).rejects.toThrow(NotFoundError);
  });

  it("when stateIds is omitted, leaves the existing territory set untouched (no deleteMany/createMany)", async () => {
    const fake = makeFakePrisma({
      distributor: {
        findFirst: vi.fn(async () => ({ id: "dist_1" })),
        update: vi.fn(async () => ({
          id: "dist_1",
          name: "Renamed Co",
          type: "DISTRIBUTOR",
          status: "ACTIVE",
          contactEmail: null,
          contactPhone: null,
          assignedUserId: null,
          assignedUser: null,
          onboardedAt: null,
          createdAt: new Date(),
          territories: [],
        })),
      },
    });
    await updateDistributor(fake as never, "c1", "dist_1", { name: "Renamed Co" });
    expect((fake.distributorTerritory.deleteMany as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((fake.distributorTerritory.createMany as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("when stateIds is provided, replaces the full territory set (delete-then-recreate)", async () => {
    const fake = makeFakePrisma({
      distributor: {
        findFirst: vi.fn(async () => ({ id: "dist_1" })),
        update: vi.fn(async () => ({
          id: "dist_1",
          name: "Existing",
          type: "DISTRIBUTOR",
          status: "ACTIVE",
          contactEmail: null,
          contactPhone: null,
          assignedUserId: null,
          assignedUser: null,
          onboardedAt: null,
          createdAt: new Date(),
          territories: [{ stateId: "st_3", state: { name: "Punjab" } }],
        })),
      },
    });
    const result = await updateDistributor(fake as never, "c1", "dist_1", { stateIds: ["st_3"] });
    expect((fake.distributorTerritory.deleteMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ where: { distributorId: "dist_1" } });
    expect((fake.distributorTerritory.createMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ data: [{ distributorId: "dist_1", stateId: "st_3" }] });
    expect(result.stateIds).toEqual(["st_3"]);
  });

  it("when stateIds is an empty array, clears the territory set (deleteMany but no createMany)", async () => {
    const fake = makeFakePrisma({
      distributor: {
        findFirst: vi.fn(async () => ({ id: "dist_1" })),
        update: vi.fn(async () => ({
          id: "dist_1",
          name: "Existing",
          type: "DISTRIBUTOR",
          status: "ACTIVE",
          contactEmail: null,
          contactPhone: null,
          assignedUserId: null,
          assignedUser: null,
          onboardedAt: null,
          createdAt: new Date(),
          territories: [],
        })),
      },
    });
    await updateDistributor(fake as never, "c1", "dist_1", { stateIds: [] });
    expect((fake.distributorTerritory.deleteMany as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ where: { distributorId: "dist_1" } });
    expect((fake.distributorTerritory.createMany as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------
 * deleteDistributor
 * ---------------------------------------------------------------------- */

describe("deleteDistributor", () => {
  it("throws NotFoundError when the distributor doesn't exist or belongs to a different company", async () => {
    const fake = makeFakePrisma();
    await expect(deleteDistributor(fake as never, "c1", "missing")).rejects.toThrow(NotFoundError);
  });

  it("deletes the distributor when found (territories cascade / SalesRecords SET NULL at the DB level)", async () => {
    const fake = makeFakePrisma({ distributor: { findFirst: vi.fn(async () => ({ id: "dist_1" })), delete: vi.fn(async () => ({ id: "dist_1" })) } });
    await deleteDistributor(fake as never, "c1", "dist_1");
    expect((fake.distributor.delete as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({ where: { id: "dist_1" } });
  });
});

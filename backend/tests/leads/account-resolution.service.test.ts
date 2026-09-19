import { describe, it, expect, vi } from "vitest";
import { normalizeAccountName, resolveOrCreateAccount, resolveOrCreateAccountCached } from "../../src/modules/leads/account-resolution.service.js";

describe("normalizeAccountName", () => {
  it("trims and lowercases", () => {
    expect(normalizeAccountName("  Acme Corp  ")).toBe("acme corp");
  });
});

function makeFakePrisma(existing: Record<string, { id: string; stateId: string | null; cityId: string | null; industryId: string | null }> = {}) {
  const created: unknown[] = [];
  const updated: unknown[] = [];
  let nextId = 1;
  return {
    prisma: {
      account: {
        findUnique: vi.fn(async ({ where }: { where: { companyId_normalizedName: { companyId: string; normalizedName: string } } }) => {
          const row = existing[where.companyId_normalizedName.normalizedName];
          return row ? { ...row } : null;
        }),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const id = `acc_new_${nextId++}`;
          created.push(data);
          return { id, ...data };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updated.push({ where, data });
          return { id: where.id, ...data };
        }),
      },
    },
    created,
    updated,
  };
}

describe("resolveOrCreateAccount", () => {
  it("creates a new Account when none exists for the normalized name", async () => {
    const { prisma, created } = makeFakePrisma();
    const id = await resolveOrCreateAccount(prisma as never, "c1", { customerName: "  Acme Corp  ", stateId: "s1", cityId: null, industryId: null });
    expect(id).toMatch(/^acc_new_/);
    expect(created).toHaveLength(1);
    expect((created[0] as Record<string, unknown>).normalizedName).toBe("acme corp");
    expect((created[0] as Record<string, unknown>).name).toBe("Acme Corp");
  });

  it("returns the existing Account id without creating a duplicate when one already matches", async () => {
    const { prisma, created } = makeFakePrisma({ "acme corp": { id: "acc_existing", stateId: "s1", cityId: "c1", industryId: "ind_1" } });
    const id = await resolveOrCreateAccount(prisma as never, "c1", { customerName: "ACME CORP", stateId: null, cityId: null, industryId: null });
    expect(id).toBe("acc_existing");
    expect(created).toHaveLength(0);
  });

  it("opportunistically fills in missing profile fields on an existing Account without overwriting real data", async () => {
    const { prisma, updated } = makeFakePrisma({ "acme corp": { id: "acc_existing", stateId: null, cityId: null, industryId: "ind_real" } });
    await resolveOrCreateAccount(prisma as never, "c1", { customerName: "Acme Corp", stateId: "s_new", cityId: "c_new", industryId: "ind_should_not_overwrite" });
    expect(updated).toHaveLength(1);
    const patch = (updated[0] as { data: Record<string, unknown> }).data;
    expect(patch.stateId).toBe("s_new");
    expect(patch.cityId).toBe("c_new");
    expect(patch.industryId).toBeUndefined(); // existing real industryId was never overwritten
  });

  it("does not call update at all when the existing Account already has all fields set", async () => {
    const { prisma, updated } = makeFakePrisma({ "acme corp": { id: "acc_existing", stateId: "s1", cityId: "c1", industryId: "ind_1" } });
    await resolveOrCreateAccount(prisma as never, "c1", { customerName: "Acme Corp", stateId: "s_new", cityId: "c_new", industryId: "ind_new" });
    expect(updated).toHaveLength(0);
  });
});

describe("resolveOrCreateAccountCached", () => {
  it("only resolves/creates once per normalizedName across repeated calls", async () => {
    const { prisma, created } = makeFakePrisma();
    const cache = new Map<string, string>();

    const id1 = await resolveOrCreateAccountCached(prisma as never, "c1", { customerName: "Acme Corp" }, cache);
    const id2 = await resolveOrCreateAccountCached(prisma as never, "c1", { customerName: "  acme corp  " }, cache);

    expect(id1).toBe(id2);
    expect(created).toHaveLength(1);
    expect(prisma.account.findUnique).toHaveBeenCalledTimes(1); // second call hit the cache, not the DB
  });
});

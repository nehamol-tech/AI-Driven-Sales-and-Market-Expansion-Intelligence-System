import type { PrismaClient } from "@prisma/client";

export function normalizeAccountName(name: string): string {
  return name.trim().toLowerCase();
}

export interface AccountResolutionInput {
  customerName: string;
  stateId?: string | null;
  cityId?: string | null;
  industryId?: string | null;
}

/**
 * Resolves (or creates) the Account for a given customerName, using the same
 * case-insensitive-trimmed matching convention already established for CSV
 * name matching (see sales-import.util.ts). This is a silent enrichment —
 * SalesRecord.customerName stays exactly the field the Sales UI reads/
 * writes; accountId is an invisible side effect of creating a sales record,
 * never a replacement for customerName.
 *
 * If the Account already exists, any missing profile fields (state/city/
 * industry) are opportunistically filled in from this sale — existing real
 * data is never overwritten.
 */
export async function resolveOrCreateAccount(prisma: PrismaClient, companyId: string, input: AccountResolutionInput): Promise<string> {
  const normalizedName = normalizeAccountName(input.customerName);

  const existing = await prisma.account.findUnique({
    where: { companyId_normalizedName: { companyId, normalizedName } },
  });

  if (existing) {
    const patch: { stateId?: string; cityId?: string; industryId?: string } = {};
    if (!existing.stateId && input.stateId) patch.stateId = input.stateId;
    if (!existing.cityId && input.cityId) patch.cityId = input.cityId;
    if (!existing.industryId && input.industryId) patch.industryId = input.industryId;
    if (Object.keys(patch).length > 0) {
      await prisma.account.update({ where: { id: existing.id }, data: patch });
    }
    return existing.id;
  }

  const created = await prisma.account.create({
    data: {
      companyId,
      name: input.customerName.trim(),
      normalizedName,
      stateId: input.stateId ?? null,
      cityId: input.cityId ?? null,
      industryId: input.industryId ?? null,
    },
  });
  return created.id;
}

/**
 * Same resolution as `resolveOrCreateAccount`, but backed by a caller-owned
 * cache keyed by normalizedName so a batch of rows for the same customer
 * (e.g. a CSV import) only resolves/creates the Account once instead of
 * once per row.
 */
export async function resolveOrCreateAccountCached(
  prisma: PrismaClient,
  companyId: string,
  input: AccountResolutionInput,
  cache: Map<string, string>,
): Promise<string> {
  const normalizedName = normalizeAccountName(input.customerName);
  const cached = cache.get(normalizedName);
  if (cached) return cached;

  const id = await resolveOrCreateAccount(prisma, companyId, input);
  cache.set(normalizedName, id);
  return id;
}

import type { Prisma, PrismaClient } from "@prisma/client";
import type { DistributorDTO } from "@ai-sales/shared";
import { NotFoundError } from "../../lib/errors.js";
import { toDistributorDTO } from "./distributors.dto.js";
import type { CreateDistributorInput, ListDistributorsQuery, UpdateDistributorInput } from "./distributors.schema.js";

const distributorInclude = {
  assignedUser: { select: { name: true } },
  territories: { select: { stateId: true, state: { select: { name: true } } } },
} satisfies Prisma.DistributorInclude;

export interface PaginatedDistributors {
  items: DistributorDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listDistributors(prisma: PrismaClient, companyId: string, query: ListDistributorsQuery): Promise<PaginatedDistributors> {
  const where: Prisma.DistributorWhereInput = {
    companyId,
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.distributor.findMany({
      where,
      include: distributorInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.distributor.count({ where }),
  ]);

  return { items: items.map(toDistributorDTO), total, page: query.page, pageSize: query.pageSize };
}

export async function getDistributor(prisma: PrismaClient, companyId: string, id: string): Promise<DistributorDTO> {
  const distributor = await prisma.distributor.findFirst({ where: { id, companyId }, include: distributorInclude });
  if (!distributor) {
    throw new NotFoundError("Distributor not found");
  }
  return toDistributorDTO(distributor);
}

/** Any authenticated role may create a Distributor — matches Prospect/SalesRecord/AdCampaign's creation precedent. `stateIds` (if given) are created as DistributorTerritory rows in the same transaction. */
export async function createDistributor(
  prisma: PrismaClient,
  companyId: string,
  createdById: string | null,
  input: CreateDistributorInput,
): Promise<DistributorDTO> {
  const distributor = await prisma.distributor.create({
    data: {
      companyId,
      name: input.name,
      type: input.type,
      status: input.status,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      assignedUserId: input.assignedUserId ?? null,
      createdById,
      onboardedAt: input.onboardedAt ?? null,
      territories: { create: input.stateIds.map((stateId) => ({ stateId })) },
    },
    include: distributorInclude,
  });
  return toDistributorDTO(distributor);
}

/**
 * Partial update. When `stateIds` is provided, the full territory set is
 * replaced (delete-then-recreate in one transaction) rather than diffed —
 * simplest correct approach for what is expected to be a small set.
 */
export async function updateDistributor(prisma: PrismaClient, companyId: string, id: string, input: UpdateDistributorInput): Promise<DistributorDTO> {
  const existing = await prisma.distributor.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Distributor not found");
  }

  const distributor = await prisma.$transaction(async (tx) => {
    if (input.stateIds !== undefined) {
      await tx.distributorTerritory.deleteMany({ where: { distributorId: id } });
      if (input.stateIds.length > 0) {
        await tx.distributorTerritory.createMany({ data: input.stateIds.map((stateId) => ({ distributorId: id, stateId })) });
      }
    }

    return tx.distributor.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.contactEmail !== undefined ? { contactEmail: input.contactEmail } : {}),
        ...(input.contactPhone !== undefined ? { contactPhone: input.contactPhone } : {}),
        ...(input.assignedUserId !== undefined ? { assignedUserId: input.assignedUserId } : {}),
        ...(input.onboardedAt !== undefined ? { onboardedAt: input.onboardedAt } : {}),
      },
      include: distributorInclude,
    });
  });

  return toDistributorDTO(distributor);
}

/**
 * ADMIN/MANAGER only (enforced at the route layer) — matches Prospect/
 * FollowUp/AdCampaign's delete precedent exactly. DistributorTerritory rows
 * cascade via their FK's `onDelete: Cascade`; any SalesRecord attributed to
 * this distributor is automatically un-attributed (never deleted) via
 * SalesRecord.distributorId's `onDelete: SetNull` — a hard delete here never
 * needs to touch SalesRecord itself.
 */
export async function deleteDistributor(prisma: PrismaClient, companyId: string, id: string): Promise<void> {
  const existing = await prisma.distributor.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Distributor not found");
  }
  await prisma.distributor.delete({ where: { id } });
}

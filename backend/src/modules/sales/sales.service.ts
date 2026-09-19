import type { Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError } from "../../lib/errors.js";
import { toSalesRecordDTO, type SalesRecordWithRelations } from "../../lib/dto.js";
import type { SalesRecordDTO } from "@ai-sales/shared";
import { resolveOrCreateAccount } from "../leads/account-resolution.service.js";
import type { CreateSalesRecordInput, ListSalesQuery, UpdateSalesRecordInput } from "./sales.schema.js";

const salesRecordInclude = {
  product: { select: { name: true } },
  state: { select: { name: true } },
  city: { select: { name: true } },
  industry: { select: { name: true } },
  salesperson: { select: { name: true } },
  distributor: { select: { name: true } },
} satisfies Prisma.SalesRecordInclude;

export interface PaginatedSalesRecords {
  items: SalesRecordDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listSalesRecords(
  prisma: PrismaClient,
  companyId: string,
  query: ListSalesQuery,
): Promise<PaginatedSalesRecords> {
  const where: Prisma.SalesRecordWhereInput = {
    companyId,
    ...(query.stateId ? { stateId: query.stateId } : {}),
    ...(query.productId ? { productId: query.productId } : {}),
    ...(query.salespersonId ? { salespersonId: query.salespersonId } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          date: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.salesRecord.findMany({
      where,
      include: salesRecordInclude,
      orderBy: { date: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.salesRecord.count({ where }),
  ]);

  return {
    items: items.map((r) => toSalesRecordDTO(r as SalesRecordWithRelations)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getSalesRecordById(prisma: PrismaClient, companyId: string, id: string): Promise<SalesRecordDTO> {
  const record = await prisma.salesRecord.findFirst({ where: { id, companyId }, include: salesRecordInclude });
  if (!record) {
    throw new NotFoundError("Sales record not found");
  }
  return toSalesRecordDTO(record as SalesRecordWithRelations);
}

export async function createSalesRecord(
  prisma: PrismaClient,
  companyId: string,
  input: CreateSalesRecordInput,
): Promise<SalesRecordDTO> {
  // Silent enrichment: resolve/create the Account behind this customerName so
  // it can be scored later. customerName remains the field the Sales UI
  // reads/writes — accountId is an invisible side effect of this write.
  const accountId = await resolveOrCreateAccount(prisma, companyId, {
    customerName: input.customerName,
    stateId: input.stateId ?? null,
    cityId: input.cityId ?? null,
    industryId: input.industryId ?? null,
  });

  const record = await prisma.salesRecord.create({
    data: {
      companyId,
      date: input.date,
      productId: input.productId ?? null,
      customerName: input.customerName,
      stateId: input.stateId ?? null,
      cityId: input.cityId ?? null,
      industryId: input.industryId ?? null,
      quantity: input.quantity,
      orderValue: input.orderValue,
      salespersonId: input.salespersonId ?? null,
      isNewCustomer: input.isNewCustomer,
      source: "MANUAL",
      accountId,
      distributorId: input.distributorId ?? null,
    },
    include: salesRecordInclude,
  });
  return toSalesRecordDTO(record as SalesRecordWithRelations);
}

export async function updateSalesRecord(
  prisma: PrismaClient,
  companyId: string,
  id: string,
  input: UpdateSalesRecordInput,
): Promise<SalesRecordDTO> {
  const existing = await prisma.salesRecord.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Sales record not found");
  }

  const record = await prisma.salesRecord.update({
    where: { id },
    data: {
      ...(input.date !== undefined ? { date: input.date } : {}),
      ...(input.productId !== undefined ? { productId: input.productId } : {}),
      ...(input.customerName !== undefined ? { customerName: input.customerName } : {}),
      ...(input.stateId !== undefined ? { stateId: input.stateId } : {}),
      ...(input.cityId !== undefined ? { cityId: input.cityId } : {}),
      ...(input.industryId !== undefined ? { industryId: input.industryId } : {}),
      ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
      ...(input.orderValue !== undefined ? { orderValue: input.orderValue } : {}),
      ...(input.salespersonId !== undefined ? { salespersonId: input.salespersonId } : {}),
      ...(input.isNewCustomer !== undefined ? { isNewCustomer: input.isNewCustomer } : {}),
      ...(input.distributorId !== undefined ? { distributorId: input.distributorId } : {}),
    },
    include: salesRecordInclude,
  });
  return toSalesRecordDTO(record as SalesRecordWithRelations);
}

export async function deleteSalesRecord(prisma: PrismaClient, companyId: string, id: string): Promise<void> {
  const existing = await prisma.salesRecord.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Sales record not found");
  }
  await prisma.salesRecord.delete({ where: { id } });
}

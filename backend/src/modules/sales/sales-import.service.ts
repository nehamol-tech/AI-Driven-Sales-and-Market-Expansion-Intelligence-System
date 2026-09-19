import type { PrismaClient, SalesImportBatch } from "@prisma/client";
import { BadRequestError } from "../../lib/errors.js";
import { resolveOrCreateAccountCached } from "../leads/account-resolution.service.js";
import {
  parseCsvContent,
  normalizeSalesCsvRow,
  type SalesImportLookups,
  type ReferenceLookupEntry,
  type NormalizedSalesRow,
} from "./sales-import.util.js";

export interface ImportError {
  row: number;
  message: string;
}

async function buildLookups(prisma: PrismaClient, companyId: string): Promise<SalesImportLookups> {
  const [states, cities, products, industries, users] = await Promise.all([
    prisma.state.findMany(),
    prisma.city.findMany(),
    prisma.product.findMany({ where: { companyId } }),
    prisma.industry.findMany(),
    prisma.user.findMany({ where: { companyId } }),
  ]);

  const statesByName = new Map<string, ReferenceLookupEntry>();
  for (const s of states) statesByName.set(s.name.toLowerCase(), { id: s.id, name: s.name });

  const citiesByStateIdAndName = new Map<string, ReferenceLookupEntry>();
  for (const c of cities) citiesByStateIdAndName.set(`${c.stateId}|${c.name.toLowerCase()}`, { id: c.id, name: c.name });

  const productsByNameOrSku = new Map<string, ReferenceLookupEntry>();
  for (const p of products) {
    productsByNameOrSku.set(p.name.toLowerCase(), { id: p.id, name: p.name });
    productsByNameOrSku.set(p.sku.toLowerCase(), { id: p.id, name: p.name });
  }

  const industriesByName = new Map<string, ReferenceLookupEntry>();
  for (const i of industries) industriesByName.set(i.name.toLowerCase(), { id: i.id, name: i.name });

  const usersByEmailOrName = new Map<string, ReferenceLookupEntry>();
  for (const u of users) {
    usersByEmailOrName.set(u.email.toLowerCase(), { id: u.id, name: u.name });
    usersByEmailOrName.set(u.name.toLowerCase(), { id: u.id, name: u.name });
  }

  return { statesByName, citiesByStateIdAndName, productsByNameOrSku, industriesByName, usersByEmailOrName };
}

export interface RunImportResult {
  batch: SalesImportBatch;
}

/**
 * Orchestrates a CSV sales import: parses the file, normalizes each row
 * against existing company reference data, records a SalesImportBatch, and
 * inserts the successfully-matched rows as SalesRecords tagged
 * source=CSV_IMPORT. Rows that reference a state/city/product/industry/
 * salesperson that can't be matched are recorded as failures with a clear
 * message rather than silently dropped or guessed.
 */
export async function runSalesCsvImport(
  prisma: PrismaClient,
  companyId: string,
  uploadedById: string | null,
  fileName: string,
  fileContent: string,
): Promise<RunImportResult> {
  let rawRows: ReturnType<typeof parseCsvContent>;
  try {
    rawRows = parseCsvContent(fileContent);
  } catch (err) {
    throw new BadRequestError("Failed to parse CSV file", {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  if (rawRows.length === 0) {
    throw new BadRequestError("CSV file contains no data rows");
  }

  const lookups = await buildLookups(prisma, companyId);

  const successes: { data: NormalizedSalesRow }[] = [];
  const errors: ImportError[] = [];

  rawRows.forEach((row, index) => {
    const rowNumber = index + 2; // +1 for 0-index, +1 for header row
    const result = normalizeSalesCsvRow(row, rowNumber, lookups);
    if (result.success) {
      successes.push({ data: result.data });
    } else {
      errors.push({ row: result.row, message: result.message });
    }
  });

  const batch = await prisma.salesImportBatch.create({
    data: {
      companyId,
      fileName,
      uploadedById,
      totalRows: rawRows.length,
      successRows: 0,
      failedRows: errors.length,
      errors: errors as unknown as object,
      status: "PROCESSING",
    },
  });

  if (successes.length > 0) {
    // Silent enrichment: resolve/create the Account behind each row's
    // customerName so it can be scored later. Cached by normalizedName so a
    // batch with repeated customers only resolves/creates each Account once.
    // Resolved sequentially (not Promise.all) so that repeated customer
    // names within the same batch hit the cache instead of racing each
    // other to create duplicate Account rows for the same normalizedName.
    const accountCache = new Map<string, string>();
    const accountIds: string[] = [];
    for (const { data } of successes) {
      const accountId = await resolveOrCreateAccountCached(
        prisma,
        companyId,
        { customerName: data.customerName, stateId: data.stateId, cityId: data.cityId, industryId: data.industryId },
        accountCache,
      );
      accountIds.push(accountId);
    }

    await prisma.salesRecord.createMany({
      data: successes.map(({ data }, index) => ({
        companyId,
        date: data.date,
        productId: data.productId,
        customerName: data.customerName,
        stateId: data.stateId,
        cityId: data.cityId,
        industryId: data.industryId,
        quantity: data.quantity,
        orderValue: data.orderValue,
        salespersonId: data.salespersonId,
        isNewCustomer: data.isNewCustomer,
        source: "CSV_IMPORT",
        importBatchId: batch.id,
        accountId: accountIds[index],
      })),
    });
  }

  const updatedBatch = await prisma.salesImportBatch.update({
    where: { id: batch.id },
    data: {
      successRows: successes.length,
      failedRows: errors.length,
      status: "COMPLETED",
    },
  });

  return { batch: updatedBatch };
}

export async function getImportBatch(prisma: PrismaClient, companyId: string, batchId: string): Promise<SalesImportBatch | null> {
  return prisma.salesImportBatch.findFirst({ where: { id: batchId, companyId } });
}

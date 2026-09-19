import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from "../../lib/errors.js";
import { toImportBatchDTO } from "../../lib/dto.js";
import { logAudit } from "../audit/audit.service.js";
import * as salesService from "./sales.service.js";
import * as salesImportService from "./sales-import.service.js";
import type { CreateSalesRecordInput, ListSalesQuery, UpdateSalesRecordInput } from "./sales.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

/**
 * SALES_USER may only update/delete sales records attributed to themselves —
 * without this, any sales user could edit or delete a colleague's sales data
 * since the underlying service only scopes by companyId, not salesperson.
 */
async function assertOwnSalesRecord(user: { id: string; companyId: string }, recordId: string): Promise<void> {
  const record = await salesService.getSalesRecordById(prisma, user.companyId, recordId);
  if (record.salespersonId !== user.id) {
    throw new ForbiddenError("Sales users may only modify their own sales records");
  }
}

export async function listSales(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const query = req.query as unknown as ListSalesQuery;
  const result = await salesService.listSalesRecords(prisma, companyId, query);
  res.status(200).json({
    data: result.items,
    pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
  });
}

export async function getSalesRecord(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const record = await salesService.getSalesRecordById(prisma, companyId, req.params.id);
  res.status(200).json(record);
}

export async function createSalesRecord(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as CreateSalesRecordInput;

  // SALES_USER may only attribute sales records to themselves.
  if (user.role === "SALES_USER" && input.salespersonId && input.salespersonId !== user.id) {
    throw new ForbiddenError("Sales users may only create sales records attributed to themselves");
  }
  const effectiveInput: CreateSalesRecordInput =
    user.role === "SALES_USER" && !input.salespersonId ? { ...input, salespersonId: user.id } : input;

  const record = await salesService.createSalesRecord(prisma, user.companyId, effectiveInput);
  await logAudit({
    userId: user.id,
    action: "SALES_RECORD_CREATE",
    entityType: "SalesRecord",
    entityId: record.id,
    metadata: { customerName: record.customerName, orderValue: record.orderValue },
    ipAddress: req.ip ?? null,
  });
  res.status(201).json(record);
}

export async function updateSalesRecord(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = req.body as UpdateSalesRecordInput;

  if (user.role === "SALES_USER" && input.salespersonId && input.salespersonId !== user.id) {
    throw new ForbiddenError("Sales users may only attribute sales records to themselves");
  }
  if (user.role === "SALES_USER") {
    await assertOwnSalesRecord(user, req.params.id);
  }

  const record = await salesService.updateSalesRecord(prisma, user.companyId, req.params.id, input);
  await logAudit({
    userId: user.id,
    action: "SALES_RECORD_UPDATE",
    entityType: "SalesRecord",
    entityId: record.id,
    metadata: input,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(record);
}

export async function deleteSalesRecord(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  if (user.role === "SALES_USER") {
    await assertOwnSalesRecord(user, req.params.id);
  }
  await salesService.deleteSalesRecord(prisma, user.companyId, req.params.id);
  await logAudit({
    userId: user.id,
    action: "SALES_RECORD_DELETE",
    entityType: "SalesRecord",
    entityId: req.params.id,
    ipAddress: req.ip ?? null,
  });
  res.status(204).send();
}

export async function importSalesCsv(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const file = req.file;
  if (!file) {
    throw new BadRequestError("No CSV file was uploaded (expected multipart field 'file')");
  }

  const fileContent = file.buffer.toString("utf-8");
  const { batch } = await salesImportService.runSalesCsvImport(prisma, user.companyId, user.id, file.originalname, fileContent);

  await logAudit({
    userId: user.id,
    action: "SALES_CSV_IMPORT",
    entityType: "SalesImportBatch",
    entityId: batch.id,
    metadata: { fileName: batch.fileName, totalRows: batch.totalRows, successRows: batch.successRows, failedRows: batch.failedRows },
    ipAddress: req.ip ?? null,
  });

  res.status(201).json(toImportBatchDTO(batch));
}

export async function getImportBatch(req: Request, res: Response): Promise<void> {
  const { companyId } = requireUser(req);
  const batch = await salesImportService.getImportBatch(prisma, companyId, req.params.batchId);
  if (!batch) {
    throw new NotFoundError("Import batch not found");
  }
  res.status(200).json(toImportBatchDTO(batch));
}

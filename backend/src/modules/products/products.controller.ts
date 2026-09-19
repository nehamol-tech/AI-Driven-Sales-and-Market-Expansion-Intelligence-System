import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { logAudit } from "../audit/audit.service.js";
import * as productsService from "./products.service.js";
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from "./products.schema.js";

function requireCompanyId(req: Request): string {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user.companyId;
}

export async function listProducts(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const query = req.query as unknown as ListProductsQuery;
  const result = await productsService.listProducts(prisma, companyId, query);
  res.status(200).json({
    data: result.items,
    pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
  });
}

export async function getProduct(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const product = await productsService.getProductById(prisma, companyId, req.params.id);
  res.status(200).json(product);
}

export async function createProduct(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const input = req.body as CreateProductInput;
  const product = await productsService.createProduct(prisma, companyId, input);
  await logAudit({
    userId: req.user?.id,
    action: "PRODUCT_CREATE",
    entityType: "Product",
    entityId: product.id,
    metadata: { name: product.name, sku: product.sku },
    ipAddress: req.ip ?? null,
  });
  res.status(201).json(product);
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const input = req.body as UpdateProductInput;
  const product = await productsService.updateProduct(prisma, companyId, req.params.id, input);
  await logAudit({
    userId: req.user?.id,
    action: "PRODUCT_UPDATE",
    entityType: "Product",
    entityId: product.id,
    metadata: input,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(product);
}

export async function deleteProduct(req: Request, res: Response): Promise<void> {
  const companyId = requireCompanyId(req);
  const product = await productsService.deleteProduct(prisma, companyId, req.params.id);
  await logAudit({
    userId: req.user?.id,
    action: "PRODUCT_DELETE",
    entityType: "Product",
    entityId: product.id,
    ipAddress: req.ip ?? null,
  });
  res.status(200).json(product);
}

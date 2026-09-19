import { Prisma, type PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { toProductDTO, type ProductWithTargets } from "../../lib/dto.js";
import type { ProductDTO } from "@ai-sales/shared";
import type { CreateProductInput, ListProductsQuery, UpdateProductInput } from "./products.schema.js";

const productInclude = {
  targetIndustries: true,
  targetBusinessTypes: true,
} satisfies Prisma.ProductInclude;

export interface PaginatedProducts {
  items: ProductDTO[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listProducts(
  prisma: PrismaClient,
  companyId: string,
  query: ListProductsQuery,
): Promise<PaginatedProducts> {
  const where: Prisma.ProductWhereInput = {
    companyId,
    ...(query.category ? { category: query.category } : {}),
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { sku: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    items: items.map((p) => toProductDTO(p as ProductWithTargets)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getProductById(prisma: PrismaClient, companyId: string, id: string): Promise<ProductDTO> {
  const product = await prisma.product.findFirst({ where: { id, companyId }, include: productInclude });
  if (!product) {
    throw new NotFoundError("Product not found");
  }
  return toProductDTO(product as ProductWithTargets);
}

async function assertSkuAvailable(prisma: PrismaClient, companyId: string, sku: string, excludeId?: string): Promise<void> {
  const existing = await prisma.product.findFirst({
    where: { companyId, sku, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  if (existing) {
    throw new ConflictError(`A product with SKU "${sku}" already exists`);
  }
}

export async function createProduct(prisma: PrismaClient, companyId: string, input: CreateProductInput): Promise<ProductDTO> {
  await assertSkuAvailable(prisma, companyId, input.sku);

  try {
    const product = await prisma.product.create({
      data: {
        companyId,
        name: input.name,
        sku: input.sku,
        category: input.category ?? null,
        description: input.description ?? null,
        price: input.price,
        minOrderQty: input.minOrderQty,
        availableQty: input.availableQty,
        keywords: input.keywords,
        isActive: input.isActive,
        targetIndustries: { create: input.targetIndustryIds.map((industryId) => ({ industryId })) },
        targetBusinessTypes: { create: input.targetBusinessTypeIds.map((businessTypeId) => ({ businessTypeId })) },
      },
      include: productInclude,
    });
    return toProductDTO(product as ProductWithTargets);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError(`A product with SKU "${input.sku}" already exists`);
    }
    throw err;
  }
}

export async function updateProduct(
  prisma: PrismaClient,
  companyId: string,
  id: string,
  input: UpdateProductInput,
): Promise<ProductDTO> {
  const existing = await prisma.product.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Product not found");
  }
  if (input.sku && input.sku !== existing.sku) {
    await assertSkuAvailable(prisma, companyId, input.sku, id);
  }

  try {
    const product = await prisma.$transaction(async (tx) => {
      if (input.targetIndustryIds !== undefined) {
        await tx.productTargetIndustry.deleteMany({ where: { productId: id } });
        if (input.targetIndustryIds.length > 0) {
          await tx.productTargetIndustry.createMany({
            data: input.targetIndustryIds.map((industryId) => ({ productId: id, industryId })),
          });
        }
      }
      if (input.targetBusinessTypeIds !== undefined) {
        await tx.productTargetBusinessType.deleteMany({ where: { productId: id } });
        if (input.targetBusinessTypeIds.length > 0) {
          await tx.productTargetBusinessType.createMany({
            data: input.targetBusinessTypeIds.map((businessTypeId) => ({ productId: id, businessTypeId })),
          });
        }
      }

      return tx.product.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.sku !== undefined ? { sku: input.sku } : {}),
          ...(input.category !== undefined ? { category: input.category } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.price !== undefined ? { price: input.price } : {}),
          ...(input.minOrderQty !== undefined ? { minOrderQty: input.minOrderQty } : {}),
          ...(input.availableQty !== undefined ? { availableQty: input.availableQty } : {}),
          ...(input.keywords !== undefined ? { keywords: input.keywords } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
        include: productInclude,
      });
    });
    return toProductDTO(product as ProductWithTargets);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new ConflictError(`A product with SKU "${input.sku ?? existing.sku}" already exists`);
    }
    throw err;
  }
}

/** Soft delete: sets isActive=false. */
export async function deleteProduct(prisma: PrismaClient, companyId: string, id: string): Promise<ProductDTO> {
  const existing = await prisma.product.findFirst({ where: { id, companyId } });
  if (!existing) {
    throw new NotFoundError("Product not found");
  }
  const product = await prisma.product.update({ where: { id }, data: { isActive: false }, include: productInclude });
  return toProductDTO(product as ProductWithTargets);
}

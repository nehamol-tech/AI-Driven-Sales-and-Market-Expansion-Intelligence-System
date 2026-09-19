import type { PrismaClient, Industry, BusinessType } from "@prisma/client";

export async function listIndustries(prisma: PrismaClient): Promise<Industry[]> {
  return prisma.industry.findMany({ orderBy: { name: "asc" } });
}

export async function listBusinessTypes(prisma: PrismaClient): Promise<BusinessType[]> {
  return prisma.businessType.findMany({ orderBy: { name: "asc" } });
}

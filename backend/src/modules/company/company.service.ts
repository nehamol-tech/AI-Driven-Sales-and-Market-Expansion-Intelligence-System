import type { PrismaClient, Prisma } from "@prisma/client";
import type { CompanyDTO } from "@ai-sales/shared";
import { NotFoundError, ConflictError } from "../../lib/errors.js";
import type { UpdateCompanyInput } from "./company.schema.js";

const companyInclude = {
  operatingStates: { include: { state: true } },
  targetStates: { include: { state: true } },
} satisfies Prisma.CompanyInclude;

type CompanyWithRelations = Prisma.CompanyGetPayload<{ include: typeof companyInclude }>;

function mapCompanyToDTO(company: CompanyWithRelations): CompanyDTO {
  return {
    id: company.id,
    name: company.name,
    industry: company.industry,
    description: company.description,
    website: company.website,
    contactEmail: company.contactEmail,
    contactPhone: company.contactPhone,
    headquartersStateId: company.headquartersStateId,
    operatingStates: company.operatingStates.map((os) => ({ stateId: os.stateId, stateName: os.state.name })),
    targetStates: company.targetStates.map((ts) => ({
      stateId: ts.stateId,
      stateName: ts.state.name,
      notes: ts.notes,
    })),
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}

export async function getCompany(prisma: PrismaClient, companyId: string): Promise<CompanyDTO> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, include: companyInclude });
  if (!company) {
    throw new NotFoundError("Company not found");
  }
  return mapCompanyToDTO(company);
}

export async function updateCompany(
  prisma: PrismaClient,
  companyId: string,
  input: UpdateCompanyInput,
): Promise<CompanyDTO> {
  const company = await prisma.company.update({
    where: { id: companyId },
    data: input,
    include: companyInclude,
  });
  return mapCompanyToDTO(company);
}

export async function addOperatingState(prisma: PrismaClient, companyId: string, stateId: string): Promise<CompanyDTO> {
  const state = await prisma.state.findUnique({ where: { id: stateId } });
  if (!state) {
    throw new NotFoundError("State not found");
  }
  await prisma.companyOperatingState.upsert({
    where: { companyId_stateId: { companyId, stateId } },
    create: { companyId, stateId },
    update: {},
  });
  return getCompany(prisma, companyId);
}

export async function removeOperatingState(prisma: PrismaClient, companyId: string, stateId: string): Promise<CompanyDTO> {
  await prisma.companyOperatingState.deleteMany({ where: { companyId, stateId } });
  return getCompany(prisma, companyId);
}

export async function addTargetState(
  prisma: PrismaClient,
  companyId: string,
  stateId: string,
  notes: string | null | undefined,
): Promise<CompanyDTO> {
  const state = await prisma.state.findUnique({ where: { id: stateId } });
  if (!state) {
    throw new NotFoundError("State not found");
  }
  const isAlreadyOperating = await prisma.companyOperatingState.findUnique({
    where: { companyId_stateId: { companyId, stateId } },
  });
  if (isAlreadyOperating) {
    throw new ConflictError("This state is already an operating state for the company");
  }
  await prisma.companyTargetState.upsert({
    where: { companyId_stateId: { companyId, stateId } },
    create: { companyId, stateId, notes: notes ?? null },
    update: { notes: notes ?? null },
  });
  return getCompany(prisma, companyId);
}

export async function removeTargetState(prisma: PrismaClient, companyId: string, stateId: string): Promise<CompanyDTO> {
  await prisma.companyTargetState.deleteMany({ where: { companyId, stateId } });
  return getCompany(prisma, companyId);
}

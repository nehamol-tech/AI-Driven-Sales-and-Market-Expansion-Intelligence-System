import type { User, Product, State, City, Industry, BusinessType, SalesRecord, SalesImportBatch } from "@prisma/client";
import type { UserDTO, StateDTO, CityDTO, IndustryDTO, BusinessTypeDTO, SalesRecordDTO } from "@ai-sales/shared";

export function toUserDTO(user: User): UserDTO {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    isActive: user.isActive,
    companyId: user.companyId,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toStateDTO(state: State): StateDTO {
  return {
    id: state.id,
    name: state.name,
    code: state.code,
    region: state.region,
  };
}

export function toCityDTO(city: City): CityDTO {
  return {
    id: city.id,
    name: city.name,
    stateId: city.stateId,
    tier: city.tier,
  };
}

export function toIndustryDTO(industry: Industry): IndustryDTO {
  return {
    id: industry.id,
    name: industry.name,
    description: industry.description,
  };
}

export function toBusinessTypeDTO(businessType: BusinessType): BusinessTypeDTO {
  return {
    id: businessType.id,
    name: businessType.name,
    description: businessType.description,
  };
}

export interface ProductWithTargets extends Product {
  targetIndustries?: { industryId: string }[];
  targetBusinessTypes?: { businessTypeId: string }[];
}

export function toProductDTO(product: ProductWithTargets): {
  id: string;
  companyId: string;
  name: string;
  sku: string;
  category: string | null;
  description: string | null;
  price: string;
  minOrderQty: number;
  availableQty: number;
  keywords: string[];
  isActive: boolean;
  targetIndustryIds: string[];
  targetBusinessTypeIds: string[];
  createdAt: string;
  updatedAt: string;
} {
  return {
    id: product.id,
    companyId: product.companyId,
    name: product.name,
    sku: product.sku,
    category: product.category,
    description: product.description,
    price: product.price.toString(),
    minOrderQty: product.minOrderQty,
    availableQty: product.availableQty,
    keywords: product.keywords,
    isActive: product.isActive,
    targetIndustryIds: (product.targetIndustries ?? []).map((t) => t.industryId),
    targetBusinessTypeIds: (product.targetBusinessTypes ?? []).map((t) => t.businessTypeId),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export interface SalesRecordWithRelations extends SalesRecord {
  product?: { name: string } | null;
  state?: { name: string } | null;
  city?: { name: string } | null;
  industry?: { name: string } | null;
  salesperson?: { name: string } | null;
  distributor?: { name: string } | null;
}

export interface ImportBatchDTO {
  batchId: string;
  status: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  errors: unknown;
}

export function toImportBatchDTO(batch: SalesImportBatch): ImportBatchDTO {
  return {
    batchId: batch.id,
    status: batch.status,
    totalRows: batch.totalRows,
    successRows: batch.successRows,
    failedRows: batch.failedRows,
    errors: batch.errors,
  };
}

export function toSalesRecordDTO(record: SalesRecordWithRelations): SalesRecordDTO {
  return {
    id: record.id,
    date: record.date.toISOString(),
    productId: record.productId,
    productName: record.product?.name ?? null,
    customerName: record.customerName,
    stateId: record.stateId,
    stateName: record.state?.name ?? null,
    cityId: record.cityId,
    cityName: record.city?.name ?? null,
    industryId: record.industryId,
    industryName: record.industry?.name ?? null,
    quantity: record.quantity,
    orderValue: record.orderValue.toString(),
    salespersonId: record.salespersonId,
    salespersonName: record.salesperson?.name ?? null,
    isNewCustomer: record.isNewCustomer,
    source: record.source,
    createdAt: record.createdAt.toISOString(),
    distributorId: record.distributorId,
    distributorName: record.distributor?.name ?? null,
  };
}

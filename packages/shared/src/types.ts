import type { Role } from "./roles.js";

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  companyId: string;
  createdAt: string;
}

export interface CompanyDTO {
  id: string;
  name: string;
  industry: string;
  description: string | null;
  website: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  headquartersStateId: string | null;
  operatingStates: { stateId: string; stateName: string }[];
  targetStates: { stateId: string; stateName: string; notes: string | null }[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductDTO {
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
}

export interface SalesRecordDTO {
  id: string;
  date: string;
  productId: string | null;
  productName: string | null;
  customerName: string;
  stateId: string | null;
  stateName: string | null;
  cityId: string | null;
  cityName: string | null;
  industryId: string | null;
  industryName: string | null;
  quantity: number;
  orderValue: string;
  salespersonId: string | null;
  salespersonName: string | null;
  isNewCustomer: boolean;
  source: "MANUAL" | "CSV_IMPORT" | "FMS_SYNC";
  createdAt: string;
  /** Phase 8: the Distributor this order is attributed to, if any — purely additive, powers distributor-expansion.service.ts's totalRevenue/orderCount. */
  distributorId?: string | null;
  distributorName?: string | null;
}

export interface StateDTO {
  id: string;
  name: string;
  code: string;
  region: string | null;
}

export interface CityDTO {
  id: string;
  name: string;
  stateId: string;
  tier: number | null;
}

export interface IndustryDTO {
  id: string;
  name: string;
  description: string | null;
}

export interface BusinessTypeDTO {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Dashboard metrics: every field is either a real computed value or explicitly
 * "insufficient_data" — never a fabricated placeholder number.
 */
export type MetricValue<T> = { status: "ok"; value: T } | { status: "insufficient_data" };

export interface DashboardOverviewDTO {
  totalSales: MetricValue<string>;
  totalOrders: MetricValue<number>;
  totalCustomers: MetricValue<number>;
  newCustomers: MetricValue<number>;
  targetExpansionStateCount: MetricValue<number>;
  topProduct: MetricValue<{ productId: string; name: string; totalOrderValue: string }>;
  averageOrderValue: MetricValue<string>;
  conversionRate: MetricValue<number>;
}

export interface ApiErrorResponse {
  error: {
    message: string;
    details?: unknown;
  };
}

import { useAuth } from "@/lib/auth-context";
import type { Role } from "@ai-sales/shared";

export interface Permissions {
  role: Role | null;
  isAdmin: boolean;
  isManager: boolean;
  isSalesUser: boolean;
  canManageUsers: boolean;
  canEditCompany: boolean;
  canManageProducts: boolean;
  canManageSales: boolean;
}

export function usePermissions(): Permissions {
  const { user } = useAuth();
  const role = user?.role ?? null;

  return {
    role,
    isAdmin: role === "ADMIN",
    isManager: role === "MANAGER",
    isSalesUser: role === "SALES_USER",
    canManageUsers: role === "ADMIN",
    canEditCompany: role === "ADMIN",
    canManageProducts: role === "ADMIN" || role === "MANAGER",
    canManageSales:
      role === "ADMIN" || role === "MANAGER" || role === "SALES_USER",
  };
}

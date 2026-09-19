export const ROLES = ["ADMIN", "MANAGER", "SALES_USER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  SALES_USER: "Sales User",
};

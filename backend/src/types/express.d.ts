import type { Role } from "@ai-sales/shared";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: Role;
        companyId: string;
      };
    }
  }
}

export {};

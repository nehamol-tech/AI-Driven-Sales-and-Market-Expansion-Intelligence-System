import { z } from "zod";
import { ROLES } from "@ai-sales/shared";

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  name: z.string().trim().min(1, "Name is required").max(200),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(ROLES).default("SALES_USER"),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const userIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

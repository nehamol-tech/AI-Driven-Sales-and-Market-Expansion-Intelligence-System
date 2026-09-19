import { z } from "zod";

export const bootstrapSchema = z.object({
  companyName: z.string().trim().min(1, "Company name is required").max(200),
  companyIndustry: z.string().trim().min(1, "Company industry is required").max(200),
  adminName: z.string().trim().min(1, "Admin name is required").max(200),
  adminEmail: z.string().trim().toLowerCase().email("A valid email is required"),
  adminPassword: z.string().min(8, "Password must be at least 8 characters"),
});
export type BootstrapInput = z.infer<typeof bootstrapSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof loginSchema>;

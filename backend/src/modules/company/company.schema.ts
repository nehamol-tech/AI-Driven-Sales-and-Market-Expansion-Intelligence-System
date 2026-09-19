import { z } from "zod";

export const updateCompanySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  industry: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  website: z.string().trim().url("Must be a valid URL").nullable().optional().or(z.literal("").transform(() => null)),
  contactEmail: z.string().trim().toLowerCase().email().nullable().optional().or(z.literal("").transform(() => null)),
  contactPhone: z.string().trim().max(30).nullable().optional(),
  headquartersStateId: z.string().trim().min(1).nullable().optional(),
});
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;

export const operatingStateSchema = z.object({
  stateId: z.string().trim().min(1, "stateId is required"),
});
export type OperatingStateInput = z.infer<typeof operatingStateSchema>;

export const targetStateSchema = z.object({
  stateId: z.string().trim().min(1, "stateId is required"),
  notes: z.string().trim().max(2000).nullable().optional(),
});
export type TargetStateInput = z.infer<typeof targetStateSchema>;

export const deleteTargetStateSchema = z.object({
  stateId: z.string().trim().min(1, "stateId is required"),
});

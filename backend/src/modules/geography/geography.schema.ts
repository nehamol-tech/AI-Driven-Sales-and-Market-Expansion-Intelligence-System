import { z } from "zod";

export const stateIdParamSchema = z.object({
  id: z.string().trim().min(1),
});

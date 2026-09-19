import { z } from "zod";
import { AD_PLATFORMS } from "@ai-sales/shared";

export const adPlatformParamSchema = z.object({
  platform: z.enum(AD_PLATFORMS),
});
export type AdPlatformParam = z.infer<typeof adPlatformParamSchema>;

export const oauthCallbackQuerySchema = z.object({
  code: z.string().trim().min(1, "code is required"),
  state: z.string().trim().min(1, "state is required"),
});
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;

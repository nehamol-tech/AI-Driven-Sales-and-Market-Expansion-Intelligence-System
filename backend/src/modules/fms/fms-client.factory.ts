import { env } from "../../config/env.js";
import { FmsApiClient, type FmsClient } from "./fms.client.js";

/** Whether this backend deployment has FMS_API_URL configured at all. */
export function isFmsConfigured(): boolean {
  return Boolean(env.FMS_API_URL);
}

/**
 * Returns null when FMS_API_URL isn't set — callers (fms.controller.ts) must
 * treat that as an honest "not configured" outcome, mirroring
 * advertising/ad-platform-clients/platform-client.factory.ts's
 * getPlatformClient exactly (never fabricate FMS data for an unconfigured
 * deployment).
 */
export function getFmsClient(): FmsClient | null {
  if (!env.FMS_API_URL) return null;
  return new FmsApiClient(env.FMS_API_URL);
}

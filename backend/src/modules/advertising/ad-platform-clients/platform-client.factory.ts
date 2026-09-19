import type { AdPlatform } from "@ai-sales/shared";
import { env } from "../../../config/env.js";
import type { AdPlatformClient } from "./ad-platform-client.interface.js";
import { MetaAdsClient } from "./meta-ads.client.js";
import { GoogleAdsClient } from "./google-ads.client.js";

/**
 * Whether this backend deployment has real client id/secret configured for
 * the platform at all — independent of whether any particular company has
 * connected it. Exposed on `AdConnectionDTO.configured` so the frontend can
 * distinguish "you haven't connected yet" from "this platform isn't set up
 * on this server".
 */
export function isPlatformConfigured(platform: AdPlatform): boolean {
  if (platform === "META") {
    return Boolean(env.META_ADS_CLIENT_ID && env.META_ADS_CLIENT_SECRET);
  }
  return Boolean(env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET);
}

/**
 * Returns null when this deployment has no client id/secret configured for
 * the platform — callers (ad-connections.service.ts, ad-sync.service.ts)
 * must treat that as an honest "not configured" outcome, never fall back to
 * a fake/demo client that would fabricate ad data.
 */
export function getPlatformClient(platform: AdPlatform): AdPlatformClient | null {
  if (platform === "META") {
    if (!env.META_ADS_CLIENT_ID || !env.META_ADS_CLIENT_SECRET) return null;
    return new MetaAdsClient(env.META_ADS_CLIENT_ID, env.META_ADS_CLIENT_SECRET);
  }
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) return null;
  return new GoogleAdsClient(env.GOOGLE_ADS_CLIENT_ID, env.GOOGLE_ADS_CLIENT_SECRET);
}

import type { MetricValue } from "./types.js";
import type { ScoreMethod } from "./leads.js";

export const AD_PLATFORMS = ["META", "GOOGLE"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

export const AD_CONNECTION_STATUSES = ["CONNECTED", "DISCONNECTED", "ERROR"] as const;
export type AdConnectionStatus = (typeof AD_CONNECTION_STATUSES)[number];

export const AD_CAMPAIGN_SOURCES = ["MANUAL", "META_SYNC", "GOOGLE_SYNC"] as const;
export type AdCampaignSource = (typeof AD_CAMPAIGN_SOURCES)[number];

/**
 * One entry always exists per platform, even when the company has never
 * connected it — `status: "DISCONNECTED"` in that case, never a missing
 * array entry (mirrors dashboard/leads' MetricValue philosophy of "always
 * present, explicitly stating what's known"). `configured` reflects whether
 * this backend deployment even has the relevant *_CLIENT_ID/*_CLIENT_SECRET
 * env vars set — independent of whether this company has connected — so the
 * frontend can distinguish "you haven't connected yet" from "this platform
 * isn't set up on this server at all".
 */
export interface AdConnectionDTO {
  platform: AdPlatform;
  status: AdConnectionStatus;
  externalAccountId: string | null;
  lastSyncedAt: string | null;
  connectedByUserName: string | null;
  configured: boolean;
}

export interface AdCampaignDTO {
  id: string;
  platform: AdPlatform;
  source: AdCampaignSource;
  name: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AdSpendRecordDTO {
  id: string;
  campaignId: string;
  date: string;
  amount: string;
  impressions: number | null;
  clicks: number | null;
  source: AdCampaignSource;
}

/**
 * Every derived metric that depends on incomplete real-world evidence
 * (leads won matched to no real Account, or an Account matched but with no
 * SalesRecord revenue since the campaign started) is a MetricValue rather
 * than a bare number — `totalSpend`/`leadsGenerated`/`leadsWon` are always
 * fully known real counts/sums, so they are NOT MetricValues; `costPerLead`/
 * `attributedRevenue`/`roas` can each legitimately be unknown.
 */
export interface CampaignAnalyticsDTO {
  campaignId: string;
  campaignName: string;
  platform: AdPlatform;
  source: AdCampaignSource;
  totalSpend: string;
  leadsGenerated: number;
  leadsWon: number;
  costPerLead: MetricValue<string>;
  attributedRevenue: MetricValue<string>;
  roas: MetricValue<number>;
}

export interface AdvertisingSummaryDTO {
  generatedAt: string;
  connections: AdConnectionDTO[];
  campaigns: CampaignAnalyticsDTO[];
  /** null only when there are zero active campaigns to narrate (mirrors revenue-analytics.service.ts's monthsOfHistory === 0 short-circuit). */
  narrative: string | null;
  narrativeMethod: ScoreMethod;
}

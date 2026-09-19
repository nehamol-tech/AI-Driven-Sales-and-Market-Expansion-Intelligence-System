import type { AdPlatform } from "@ai-sales/shared";

export interface PlatformSpendPoint {
  date: string; // ISO calendar date, "YYYY-MM-DD"
  amount: number;
  impressions: number | null;
  clicks: number | null;
}

export interface PlatformCampaignInsight {
  externalCampaignId: string;
  name: string;
  startDate: string; // ISO calendar date
  endDate: string | null;
  isActive: boolean;
  spendByDate: PlatformSpendPoint[];
}

export interface ExchangeCodeResult {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  externalAccountId: string | null;
}

/**
 * Narrow, platform-agnostic contract both real ad-platform clients
 * implement. This app has zero real Meta/Google Ads developer credentials
 * configured (confirmed: no env vars exist), so the OAuth handshake and live
 * API calls below cannot be exercised against the real services in this
 * environment — only their request shape and response-parsing logic are
 * unit-tested here, against hand-written fixture JSON shaped like the real
 * APIs' documented responses (see tests/advertising/meta-ads.client.test.ts
 * and google-ads.client.test.ts).
 */
export interface AdPlatformClient {
  readonly platform: AdPlatform;
  getAuthorizeUrl(state: string, redirectUri: string): string;
  exchangeCodeForTokens(code: string, redirectUri: string): Promise<ExchangeCodeResult>;
  fetchCampaignsWithInsights(accessToken: string, externalAccountId: string): Promise<PlatformCampaignInsight[]>;
}

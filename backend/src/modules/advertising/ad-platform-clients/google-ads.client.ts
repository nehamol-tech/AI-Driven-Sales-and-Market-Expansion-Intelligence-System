import type { AdPlatform } from "@ai-sales/shared";
import type { AdPlatformClient, ExchangeCodeResult, PlatformCampaignInsight, PlatformSpendPoint } from "./ad-platform-client.interface.js";

/**
 * Google Ads API client (REST `searchStream` on v16 at the time this was
 * written — bump the version segment when real developer credentials are
 * eventually configured). A production deployment would also need a
 * `developer-token` header, and typically `login-customer-id` for
 * manager-account access — there is no env var for either yet since this
 * phase has zero real Google Ads developer credentials to test against;
 * documented here rather than guessed at with a made-up env var name.
 * NEVER logs `accessToken`, `clientSecret`, or any header/URL that carries
 * one.
 */
const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com/v16";
const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";

const CAMPAIGN_GAQL_QUERY = [
  "SELECT campaign.id, campaign.name, campaign.start_date, campaign.end_date, campaign.status,",
  "metrics.cost_micros, metrics.impressions, metrics.clicks, segments.date",
  "FROM campaign",
  "WHERE segments.date DURING LAST_30_DAYS",
].join(" ");

export interface GoogleAdsCampaignField {
  id: string;
  name: string;
  startDate: string;
  endDate: string | null;
  status: string;
}

export interface GoogleAdsRow {
  campaign: GoogleAdsCampaignField;
  metrics?: {
    costMicros?: string;
    impressions?: string;
    clicks?: string;
  };
  segments?: {
    date?: string;
  };
}

/**
 * Pure parse of a `googleAds:searchStream` response — a top-level array of
 * chunks, each shaped `{ results: GoogleAdsRow[] }` per Google's documented
 * REST JSON convention (camelCase field names). No I/O — unit-testable
 * against a hand-written fixture.
 */
export function parseGoogleAdsSearchStreamResponse(json: unknown): GoogleAdsRow[] {
  if (!Array.isArray(json)) {
    throw new Error("Unexpected Google Ads searchStream response shape: expected a top-level array of result chunks");
  }
  const rows: GoogleAdsRow[] = [];
  for (const rawChunk of json) {
    const chunk = rawChunk as { results?: unknown };
    if (!Array.isArray(chunk.results)) continue;
    for (const rawRow of chunk.results) {
      const row = rawRow as Record<string, unknown>;
      const campaign = row.campaign as Record<string, unknown> | undefined;
      if (!campaign || typeof campaign.id !== "string" || typeof campaign.name !== "string" || typeof campaign.startDate !== "string" || typeof campaign.status !== "string") {
        throw new Error("Unexpected Google Ads row shape: missing one of campaign.id/name/startDate/status");
      }
      const metrics = row.metrics as Record<string, unknown> | undefined;
      const segments = row.segments as Record<string, unknown> | undefined;
      rows.push({
        campaign: {
          id: campaign.id,
          name: campaign.name,
          startDate: campaign.startDate,
          endDate: typeof campaign.endDate === "string" ? campaign.endDate : null,
          status: campaign.status,
        },
        metrics: metrics
          ? {
              costMicros: typeof metrics.costMicros === "string" ? metrics.costMicros : undefined,
              impressions: typeof metrics.impressions === "string" ? metrics.impressions : undefined,
              clicks: typeof metrics.clicks === "string" ? metrics.clicks : undefined,
            }
          : undefined,
        segments: segments && typeof segments.date === "string" ? { date: segments.date } : undefined,
      });
    }
  }
  return rows;
}

/**
 * Pure merge of GAQL rows (one row per campaign per day, per the query
 * above) into the platform-agnostic shape. `costMicros` is millionths of
 * the account's currency unit, divided down to a plain decimal amount. A
 * row with no `segments.date` (shouldn't happen given this query, but
 * guarded defensively) contributes no spend point rather than a guessed
 * date.
 */
export function buildGooglePlatformInsights(rows: GoogleAdsRow[]): PlatformCampaignInsight[] {
  const byCampaign = new Map<string, { campaign: GoogleAdsCampaignField; spend: PlatformSpendPoint[] }>();
  for (const row of rows) {
    const entry = byCampaign.get(row.campaign.id) ?? { campaign: row.campaign, spend: [] };
    if (row.segments?.date) {
      entry.spend.push({
        date: row.segments.date,
        amount: row.metrics?.costMicros ? Number(row.metrics.costMicros) / 1_000_000 : 0,
        impressions: row.metrics?.impressions ? Number(row.metrics.impressions) : null,
        clicks: row.metrics?.clicks ? Number(row.metrics.clicks) : null,
      });
    }
    byCampaign.set(row.campaign.id, entry);
  }

  return Array.from(byCampaign.values()).map(({ campaign, spend }) => ({
    externalCampaignId: campaign.id,
    name: campaign.name,
    startDate: campaign.startDate,
    endDate: campaign.endDate ?? null,
    isActive: campaign.status === "ENABLED",
    spendByDate: spend,
  }));
}

export class GoogleAdsClient implements AdPlatformClient {
  readonly platform: AdPlatform = "GOOGLE";

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  getAuthorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", GOOGLE_ADS_SCOPE);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return url.toString();
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<ExchangeCodeResult> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
    });

    const res = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      throw new Error(`Google token exchange failed with HTTP ${res.status}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    if (typeof json.access_token !== "string") {
      throw new Error("Google token exchange response did not include access_token");
    }
    return {
      accessToken: json.access_token,
      refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
      expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : null,
      // Google's token endpoint doesn't return a customer id either — the
      // caller must separately call customers:listAccessibleCustomers once
      // real credentials exist to let the user pick which account to
      // connect. Left null here for the same reason as Meta's client.
      externalAccountId: null,
    };
  }

  async fetchCampaignsWithInsights(accessToken: string, externalAccountId: string): Promise<PlatformCampaignInsight[]> {
    const res = await fetch(`${GOOGLE_ADS_API_BASE}/customers/${externalAccountId}/googleAds:searchStream`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: CAMPAIGN_GAQL_QUERY }),
    });
    if (!res.ok) {
      throw new Error(`Google Ads campaigns fetch failed with HTTP ${res.status}`);
    }
    const rows = parseGoogleAdsSearchStreamResponse(await res.json());
    return buildGooglePlatformInsights(rows);
  }
}

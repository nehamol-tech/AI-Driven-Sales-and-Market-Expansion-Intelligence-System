import type { AdPlatform } from "@ai-sales/shared";
import type { AdPlatformClient, ExchangeCodeResult, PlatformCampaignInsight, PlatformSpendPoint } from "./ad-platform-client.interface.js";

/**
 * Meta Marketing API client (Graph API v19.0 at the time this was written —
 * bump the version segment below when real developer credentials are
 * eventually configured; Meta deprecates Graph API versions on a rolling
 * ~2-year schedule, so the exact version is far less important than this
 * client having a correct, sensible shape). NEVER logs `accessToken`,
 * `clientSecret`, or any URL/header that carries one — not even at debug
 * level.
 */
const META_OAUTH_DIALOG_URL = "https://www.facebook.com/v19.0/dialog/oauth";
const META_GRAPH_BASE = "https://graph.facebook.com/v19.0";
const META_SCOPES = "ads_read,ads_management";

export interface MetaCampaignNode {
  id: string;
  name: string;
  start_time: string;
  stop_time: string | null;
  status: string;
}

export interface MetaInsightRow {
  campaign_id: string;
  date_start: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
}

/**
 * Pure parse of `GET /act_{id}/campaigns?fields=id,name,start_time,stop_time,status`.
 * No I/O — unit-testable in isolation against a hand-written fixture shaped
 * like Meta's real `{ data: [...] }` envelope.
 */
export function parseMetaCampaignsResponse(json: unknown): MetaCampaignNode[] {
  if (!json || typeof json !== "object" || !Array.isArray((json as { data?: unknown }).data)) {
    throw new Error("Unexpected Meta campaigns response shape: expected an object with a 'data' array");
  }
  return ((json as { data: unknown[] }).data).map((raw) => {
    const node = raw as Record<string, unknown>;
    if (typeof node.id !== "string" || typeof node.name !== "string" || typeof node.start_time !== "string" || typeof node.status !== "string") {
      throw new Error("Unexpected Meta campaign node shape: missing one of id/name/start_time/status");
    }
    return {
      id: node.id,
      name: node.name,
      start_time: node.start_time,
      stop_time: typeof node.stop_time === "string" ? node.stop_time : null,
      status: node.status,
    };
  });
}

/**
 * Pure parse of the account-level, campaign-broken-down insights response
 * (`GET /act_{id}/insights?level=campaign&time_increment=1&fields=campaign_id,spend,impressions,clicks,date_start`).
 * Rows missing campaign_id/date_start are silently dropped rather than
 * guessed — Meta's insights endpoint can return a row for the whole account
 * with no campaign_id when `level` isn't respected by an intermediate proxy;
 * such a row carries no attributable information and must never be forced
 * onto a campaign it doesn't belong to.
 */
export function parseMetaInsightsResponse(json: unknown): MetaInsightRow[] {
  if (!json || typeof json !== "object" || !Array.isArray((json as { data?: unknown }).data)) {
    throw new Error("Unexpected Meta insights response shape: expected an object with a 'data' array");
  }
  return ((json as { data: unknown[] }).data)
    .map((raw) => raw as Record<string, unknown>)
    .filter((row) => typeof row.campaign_id === "string" && typeof row.date_start === "string")
    .map((row) => ({
      campaign_id: row.campaign_id as string,
      date_start: row.date_start as string,
      spend: typeof row.spend === "string" ? row.spend : undefined,
      impressions: typeof row.impressions === "string" ? row.impressions : undefined,
      clicks: typeof row.clicks === "string" ? row.clicks : undefined,
    }));
}

/**
 * Pure merge of campaigns + insights into the platform-agnostic shape.
 * Never fabricates a spend value for a campaign with no matching insight
 * rows — it simply gets an empty `spendByDate`, which
 * advertising-analytics.service.ts's `insufficient_data` handling already
 * covers correctly.
 */
export function buildMetaPlatformInsights(campaigns: MetaCampaignNode[], insights: MetaInsightRow[]): PlatformCampaignInsight[] {
  const spendByCampaign = new Map<string, PlatformSpendPoint[]>();
  for (const row of insights) {
    const points = spendByCampaign.get(row.campaign_id) ?? [];
    points.push({
      date: row.date_start,
      amount: row.spend ? Number(row.spend) : 0,
      impressions: row.impressions ? Number(row.impressions) : null,
      clicks: row.clicks ? Number(row.clicks) : null,
    });
    spendByCampaign.set(row.campaign_id, points);
  }

  return campaigns.map((c) => ({
    externalCampaignId: c.id,
    name: c.name,
    startDate: c.start_time.slice(0, 10),
    endDate: c.stop_time ? c.stop_time.slice(0, 10) : null,
    isActive: c.status === "ACTIVE",
    spendByDate: spendByCampaign.get(c.id) ?? [],
  }));
}

export class MetaAdsClient implements AdPlatformClient {
  readonly platform: AdPlatform = "META";

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  getAuthorizeUrl(state: string, redirectUri: string): string {
    const url = new URL(META_OAUTH_DIALOG_URL);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", META_SCOPES);
    url.searchParams.set("response_type", "code");
    return url.toString();
  }

  async exchangeCodeForTokens(code: string, redirectUri: string): Promise<ExchangeCodeResult> {
    const url = new URL(`${META_GRAPH_BASE}/oauth/access_token`);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("client_secret", this.clientSecret);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("code", code);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`Meta token exchange failed with HTTP ${res.status}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    if (typeof json.access_token !== "string") {
      throw new Error("Meta token exchange response did not include access_token");
    }
    return {
      accessToken: json.access_token,
      // Meta's short-lived user-token exchange does not return a distinct
      // refresh token the way Google's does — a long-lived (60-day) token is
      // obtained via a SEPARATE "fb_exchange_token" call. That second call is
      // deliberately not implemented yet: it can't be verified against the
      // real API without real credentials, so this client is honest about
      // returning null here rather than guessing at a shape.
      refreshToken: null,
      expiresInSeconds: typeof json.expires_in === "number" ? json.expires_in : null,
      // The ad account id isn't returned by the token exchange itself — Meta
      // requires a separate "GET /me/adaccounts" call once authenticated so
      // the user can pick which ad account to connect. Left null here;
      // wiring that selection step is out of scope until real credentials
      // exist to verify it against.
      externalAccountId: null,
    };
  }

  async fetchCampaignsWithInsights(accessToken: string, externalAccountId: string): Promise<PlatformCampaignInsight[]> {
    const campaignsUrl = new URL(`${META_GRAPH_BASE}/act_${externalAccountId}/campaigns`);
    campaignsUrl.searchParams.set("fields", "id,name,start_time,stop_time,status");
    campaignsUrl.searchParams.set("access_token", accessToken);

    const insightsUrl = new URL(`${META_GRAPH_BASE}/act_${externalAccountId}/insights`);
    insightsUrl.searchParams.set("level", "campaign");
    insightsUrl.searchParams.set("time_increment", "1");
    insightsUrl.searchParams.set("fields", "campaign_id,spend,impressions,clicks,date_start");
    insightsUrl.searchParams.set("access_token", accessToken);

    const [campaignsRes, insightsRes] = await Promise.all([fetch(campaignsUrl.toString()), fetch(insightsUrl.toString())]);
    if (!campaignsRes.ok) {
      throw new Error(`Meta campaigns fetch failed with HTTP ${campaignsRes.status}`);
    }
    if (!insightsRes.ok) {
      throw new Error(`Meta insights fetch failed with HTTP ${insightsRes.status}`);
    }

    const campaigns = parseMetaCampaignsResponse(await campaignsRes.json());
    const insights = parseMetaInsightsResponse(await insightsRes.json());
    return buildMetaPlatformInsights(campaigns, insights);
  }
}

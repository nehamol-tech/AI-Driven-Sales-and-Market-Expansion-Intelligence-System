import { describe, it, expect } from "vitest";
import { parseMetaCampaignsResponse, parseMetaInsightsResponse, buildMetaPlatformInsights, MetaAdsClient } from "../../src/modules/advertising/ad-platform-clients/meta-ads.client.js";

/** Hand-written fixtures shaped like Meta's real Graph API responses (no network call, no mocked fetch needed — the parsing functions are pure). */
const CAMPAIGNS_FIXTURE = {
  data: [
    { id: "1001", name: "Spring Sale", start_time: "2026-01-01T00:00:00+0000", stop_time: "2026-03-31T00:00:00+0000", status: "ACTIVE" },
    { id: "1002", name: "Brand Awareness", start_time: "2026-02-15T00:00:00+0000", stop_time: null, status: "PAUSED" },
  ],
  paging: { cursors: { before: "abc", after: "def" } },
};

const INSIGHTS_FIXTURE = {
  data: [
    { campaign_id: "1001", date_start: "2026-01-05", date_stop: "2026-01-05", spend: "150.50", impressions: "10000", clicks: "200" },
    { campaign_id: "1001", date_start: "2026-01-06", date_stop: "2026-01-06", spend: "175.25", impressions: "11000", clicks: "220" },
    // 1002 has no insight rows at all — a campaign with zero recorded spend.
  ],
};

describe("parseMetaCampaignsResponse", () => {
  it("parses a realistic campaigns list response", () => {
    const result = parseMetaCampaignsResponse(CAMPAIGNS_FIXTURE);
    expect(result).toEqual([
      { id: "1001", name: "Spring Sale", start_time: "2026-01-01T00:00:00+0000", stop_time: "2026-03-31T00:00:00+0000", status: "ACTIVE" },
      { id: "1002", name: "Brand Awareness", start_time: "2026-02-15T00:00:00+0000", stop_time: null, status: "PAUSED" },
    ]);
  });

  it("throws on an unexpected top-level shape", () => {
    expect(() => parseMetaCampaignsResponse({ notData: [] })).toThrow();
    expect(() => parseMetaCampaignsResponse(null)).toThrow();
  });

  it("throws on a campaign node missing a required field", () => {
    expect(() => parseMetaCampaignsResponse({ data: [{ id: "1", name: "X" }] })).toThrow();
  });
});

describe("parseMetaInsightsResponse", () => {
  it("parses a realistic insights response", () => {
    const result = parseMetaInsightsResponse(INSIGHTS_FIXTURE);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ campaign_id: "1001", date_start: "2026-01-05", spend: "150.50", impressions: "10000", clicks: "200" });
  });

  it("drops rows missing campaign_id/date_start rather than guessing", () => {
    const malformed = { data: [{ spend: "100" }, { campaign_id: "1001", date_start: "2026-01-01", spend: "50" }] };
    const result = parseMetaInsightsResponse(malformed);
    expect(result).toHaveLength(1);
    expect(result[0].campaign_id).toBe("1001");
  });

  it("throws on an unexpected top-level shape", () => {
    expect(() => parseMetaInsightsResponse({})).toThrow();
  });
});

describe("buildMetaPlatformInsights", () => {
  it("merges campaigns + insights into the platform-agnostic shape, with real spend on 1001 and empty spendByDate on 1002", () => {
    const campaigns = parseMetaCampaignsResponse(CAMPAIGNS_FIXTURE);
    const insights = parseMetaInsightsResponse(INSIGHTS_FIXTURE);
    const result = buildMetaPlatformInsights(campaigns, insights);

    expect(result).toHaveLength(2);

    const springSale = result.find((r) => r.externalCampaignId === "1001");
    expect(springSale).toMatchObject({ name: "Spring Sale", startDate: "2026-01-01", endDate: "2026-03-31", isActive: true });
    expect(springSale?.spendByDate).toEqual([
      { date: "2026-01-05", amount: 150.5, impressions: 10000, clicks: 200 },
      { date: "2026-01-06", amount: 175.25, impressions: 11000, clicks: 220 },
    ]);

    const brandAwareness = result.find((r) => r.externalCampaignId === "1002");
    expect(brandAwareness).toMatchObject({ name: "Brand Awareness", endDate: null, isActive: false });
    // Never fabricates a spend value for a campaign with no matching insight rows.
    expect(brandAwareness?.spendByDate).toEqual([]);
  });
});

describe("MetaAdsClient.getAuthorizeUrl", () => {
  it("builds a URL against the real Meta OAuth dialog endpoint with the expected params", () => {
    const client = new MetaAdsClient("client-id-123", "client-secret-abc");
    const url = new URL(client.getAuthorizeUrl("state-token-xyz", "https://app.example.com/api/advertising/connections/META/callback"));

    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v19.0/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("client-id-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/api/advertising/connections/META/callback");
    expect(url.searchParams.get("state")).toBe("state-token-xyz");
    expect(url.searchParams.get("response_type")).toBe("code");
    // Never puts the client secret in the authorize URL.
    expect(url.toString()).not.toContain("client-secret-abc");
  });
});

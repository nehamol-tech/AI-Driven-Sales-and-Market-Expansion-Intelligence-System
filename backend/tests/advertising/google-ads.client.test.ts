import { describe, it, expect } from "vitest";
import {
  parseGoogleAdsSearchStreamResponse,
  buildGooglePlatformInsights,
  GoogleAdsClient,
} from "../../src/modules/advertising/ad-platform-clients/google-ads.client.js";

/** Hand-written fixture shaped like Google Ads API's real searchStream REST/JSON response — a top-level array of chunks, each `{ results: [...] }`. */
const SEARCH_STREAM_FIXTURE = [
  {
    results: [
      {
        campaign: { resourceName: "customers/123/campaigns/456", id: "456", name: "Summer Promo", status: "ENABLED", startDate: "2026-01-01", endDate: "2026-06-30" },
        metrics: { costMicros: "1500000", impressions: "1000", clicks: "50" },
        segments: { date: "2026-01-05" },
      },
      {
        campaign: { resourceName: "customers/123/campaigns/456", id: "456", name: "Summer Promo", status: "ENABLED", startDate: "2026-01-01", endDate: "2026-06-30" },
        metrics: { costMicros: "2000000", impressions: "1200", clicks: "60" },
        segments: { date: "2026-01-06" },
      },
    ],
  },
  {
    results: [
      {
        campaign: { resourceName: "customers/123/campaigns/789", id: "789", name: "Retargeting", status: "PAUSED", startDate: "2026-02-01", endDate: null },
        // No metrics at all for this row — a real campaign with zero spend that day.
        segments: { date: "2026-02-10" },
      },
    ],
  },
];

describe("parseGoogleAdsSearchStreamResponse", () => {
  it("parses a realistic multi-chunk searchStream response", () => {
    const rows = parseGoogleAdsSearchStreamResponse(SEARCH_STREAM_FIXTURE);
    expect(rows).toHaveLength(3);
    expect(rows[0].campaign).toEqual({ id: "456", name: "Summer Promo", startDate: "2026-01-01", endDate: "2026-06-30", status: "ENABLED" });
    expect(rows[0].metrics).toEqual({ costMicros: "1500000", impressions: "1000", clicks: "50" });
    expect(rows[2].metrics).toBeUndefined();
  });

  it("throws on a non-array top-level response", () => {
    expect(() => parseGoogleAdsSearchStreamResponse({ results: [] })).toThrow();
  });

  it("skips chunks with no results array rather than crashing", () => {
    const rows = parseGoogleAdsSearchStreamResponse([{ fieldMask: "campaign.id" }, ...SEARCH_STREAM_FIXTURE]);
    expect(rows).toHaveLength(3);
  });

  it("throws on a row missing required campaign fields", () => {
    expect(() => parseGoogleAdsSearchStreamResponse([{ results: [{ campaign: { id: "1" } }] }])).toThrow();
  });
});

describe("buildGooglePlatformInsights", () => {
  it("groups rows by campaign and converts costMicros to a plain decimal amount", () => {
    const rows = parseGoogleAdsSearchStreamResponse(SEARCH_STREAM_FIXTURE);
    const result = buildGooglePlatformInsights(rows);

    expect(result).toHaveLength(2);

    const summerPromo = result.find((r) => r.externalCampaignId === "456");
    expect(summerPromo).toMatchObject({ name: "Summer Promo", startDate: "2026-01-01", endDate: "2026-06-30", isActive: true });
    expect(summerPromo?.spendByDate).toEqual([
      { date: "2026-01-05", amount: 1.5, impressions: 1000, clicks: 50 },
      { date: "2026-01-06", amount: 2, impressions: 1200, clicks: 60 },
    ]);

    const retargeting = result.find((r) => r.externalCampaignId === "789");
    expect(retargeting).toMatchObject({ name: "Retargeting", endDate: null, isActive: false });
    // No metrics on that row -> amount defaults to 0, never fabricated.
    expect(retargeting?.spendByDate).toEqual([{ date: "2026-02-10", amount: 0, impressions: null, clicks: null }]);
  });

  it("produces no spend point for a row with no segments.date", () => {
    const rows = parseGoogleAdsSearchStreamResponse([
      { results: [{ campaign: { id: "999", name: "No Date Row", status: "ENABLED", startDate: "2026-01-01" } }] },
    ]);
    const result = buildGooglePlatformInsights(rows);
    expect(result[0].spendByDate).toEqual([]);
  });
});

describe("GoogleAdsClient.getAuthorizeUrl", () => {
  it("builds a URL against the real Google OAuth endpoint with offline access requested", () => {
    const client = new GoogleAdsClient("google-client-id", "google-client-secret");
    const url = new URL(client.getAuthorizeUrl("state-abc", "https://app.example.com/api/advertising/connections/GOOGLE/callback"));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("google-client-id");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/adwords");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("state")).toBe("state-abc");
    expect(url.toString()).not.toContain("google-client-secret");
  });
});

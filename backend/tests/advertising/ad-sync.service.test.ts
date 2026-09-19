import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "../../src/config/env.js";
import { encryptSecret } from "../../src/lib/crypto.js";
import { syncCampaignsFromPlatform, type AdSyncPrismaDeps } from "../../src/modules/advertising/ad-sync.service.js";
import type { AdPlatformClient, PlatformCampaignInsight } from "../../src/modules/advertising/ad-platform-clients/ad-platform-client.interface.js";
import { NotFoundError } from "../../src/lib/errors.js";

function makeFakeClient(insights: PlatformCampaignInsight[]): AdPlatformClient {
  return {
    platform: "META",
    getAuthorizeUrl: () => "",
    exchangeCodeForTokens: async () => ({ accessToken: "x", refreshToken: null, expiresInSeconds: null, externalAccountId: null }),
    fetchCampaignsWithInsights: vi.fn(async () => insights),
  };
}

/** In-memory fake Prisma-like store for AdCampaign/AdSpendRecord, mirroring how sales-import.service.ts's tests would fake a batch-with-error-collection pipeline. */
function makeFakeDeps(): { deps: AdSyncPrismaDeps; campaigns: any[]; spendRecords: any[]; connection: any } {
  const campaigns: any[] = [];
  const spendRecords: any[] = [];
  let nextCampaignId = 1;
  let nextSpendId = 1;

  const connection = {
    id: "conn_1",
    companyId: "c1",
    platform: "META",
    status: "CONNECTED",
    accessTokenEncrypted: encryptSecret("real-access-token-value"),
    externalAccountId: "act_123",
    lastSyncedAt: null as Date | null,
  };

  const deps: AdSyncPrismaDeps = {
    adAccountConnection: {
      findUnique: vi.fn(async () => connection),
      update: vi.fn(async (args: any) => {
        Object.assign(connection, args.data);
        return connection;
      }),
    },
    adCampaign: {
      findFirst: vi.fn(async (args: any) => campaigns.find((c) => c.companyId === args.where.companyId && c.platform === args.where.platform && c.externalCampaignId === args.where.externalCampaignId) ?? null),
      create: vi.fn(async (args: any) => {
        const row = { id: `camp_${nextCampaignId++}`, ...args.data };
        campaigns.push(row);
        return row;
      }),
      update: vi.fn(async (args: any) => {
        const row = campaigns.find((c) => c.id === args.where.id);
        Object.assign(row, args.data);
        return row;
      }),
    },
    adSpendRecord: {
      findFirst: vi.fn(async (args: any) => spendRecords.find((s) => s.campaignId === args.where.campaignId && s.date.getTime() === args.where.date.getTime()) ?? null),
      create: vi.fn(async (args: any) => {
        const row = { id: `spend_${nextSpendId++}`, ...args.data };
        spendRecords.push(row);
        return row;
      }),
      update: vi.fn(async (args: any) => {
        const row = spendRecords.find((s) => s.id === args.where.id);
        Object.assign(row, args.data);
        return row;
      }),
    },
  };

  return { deps, campaigns, spendRecords, connection };
}

function fixtureInsight(overrides: Partial<PlatformCampaignInsight> = {}): PlatformCampaignInsight {
  return {
    externalCampaignId: "ext_1",
    name: "Synced Campaign",
    startDate: "2026-01-01",
    endDate: null,
    isActive: true,
    spendByDate: [{ date: "2026-01-05", amount: 100, impressions: 1000, clicks: 20 }],
    ...overrides,
  };
}

describe("syncCampaignsFromPlatform", () => {
  const originalKey = env.CREDENTIAL_ENCRYPTION_KEY;

  beforeEach(() => {
    env.CREDENTIAL_ENCRYPTION_KEY = "test-sync-encryption-key";
  });
  afterEach(() => {
    env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });

  it("creates a new campaign + spend record tagged META_SYNC on first sync", async () => {
    const { deps, campaigns, spendRecords } = makeFakeDeps();
    const client = makeFakeClient([fixtureInsight()]);

    const result = await syncCampaignsFromPlatform(deps, client, "c1", "META");

    expect(result).toEqual({ campaignsSynced: 1, spendRecordsSynced: 1, errors: [] });
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].source).toBe("META_SYNC");
    expect(spendRecords).toHaveLength(1);
    expect(spendRecords[0].source).toBe("META_SYNC");
  });

  it("updates lastSyncedAt on the connection after a sync", async () => {
    const { deps, connection } = makeFakeDeps();
    const client = makeFakeClient([fixtureInsight()]);
    await syncCampaignsFromPlatform(deps, client, "c1", "META");
    expect(connection.lastSyncedAt).toBeInstanceOf(Date);
  });

  it("upsert-not-duplicate: syncing the same campaign+spend twice updates in place rather than creating duplicates", async () => {
    const { deps, campaigns, spendRecords } = makeFakeDeps();
    const client = makeFakeClient([fixtureInsight({ spendByDate: [{ date: "2026-01-05", amount: 100, impressions: 1000, clicks: 20 }] })]);

    await syncCampaignsFromPlatform(deps, client, "c1", "META");
    expect(campaigns).toHaveLength(1);
    expect(spendRecords).toHaveLength(1);

    // Second sync with updated spend amount for the same campaign+date.
    const client2 = makeFakeClient([fixtureInsight({ spendByDate: [{ date: "2026-01-05", amount: 150, impressions: 1500, clicks: 30 }] })]);
    const result2 = await syncCampaignsFromPlatform(deps, client2, "c1", "META");

    expect(campaigns).toHaveLength(1); // still just one campaign row
    expect(spendRecords).toHaveLength(1); // still just one spend row, updated in place
    expect(spendRecords[0].amount).toBe(150);
    expect(result2).toEqual({ campaignsSynced: 1, spendRecordsSynced: 1, errors: [] });
  });

  it("collects an error for a malformed insight row without aborting the rest of the batch", async () => {
    const { deps, campaigns } = makeFakeDeps();
    const client = makeFakeClient([
      fixtureInsight({ externalCampaignId: "", name: "Bad Row" }), // missing externalCampaignId
      fixtureInsight({ externalCampaignId: "ext_2", name: "Good Row" }),
    ]);

    const result = await syncCampaignsFromPlatform(deps, client, "c1", "META");

    expect(result.campaignsSynced).toBe(1);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(campaigns).toHaveLength(1);
    expect(campaigns[0].externalCampaignId).toBe("ext_2");
  });

  it("collects an error for an invalid spend date without dropping the campaign or other spend rows", async () => {
    const { deps, campaigns, spendRecords } = makeFakeDeps();
    const client = makeFakeClient([
      fixtureInsight({
        spendByDate: [
          { date: "not-a-date", amount: 10, impressions: null, clicks: null },
          { date: "2026-01-07", amount: 20, impressions: null, clicks: null },
        ],
      }),
    ]);

    const result = await syncCampaignsFromPlatform(deps, client, "c1", "META");
    expect(campaigns).toHaveLength(1);
    expect(spendRecords).toHaveLength(1);
    expect(result.spendRecordsSynced).toBe(1);
    expect(result.errors.some((e) => e.includes("invalid spend date"))).toBe(true);
  });

  it("throws NotFoundError when there is no CONNECTED account for the platform", async () => {
    const { deps } = makeFakeDeps();
    (deps.adAccountConnection.findUnique as any).mockResolvedValue(null);
    const client = makeFakeClient([fixtureInsight()]);
    await expect(syncCampaignsFromPlatform(deps, client, "c1", "META")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError when the connection exists but is DISCONNECTED", async () => {
    const { deps } = makeFakeDeps();
    (deps.adAccountConnection.findUnique as any).mockResolvedValue({ status: "DISCONNECTED", accessTokenEncrypted: null, externalAccountId: null });
    const client = makeFakeClient([fixtureInsight()]);
    await expect(syncCampaignsFromPlatform(deps, client, "c1", "META")).rejects.toBeInstanceOf(NotFoundError);
  });
});

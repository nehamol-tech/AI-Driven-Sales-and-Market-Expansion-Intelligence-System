/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AdPlatform } from "@ai-sales/shared";
import { NotFoundError } from "../../lib/errors.js";
import { decryptSecret } from "../../lib/crypto.js";
import type { AdPlatformClient, PlatformCampaignInsight } from "./ad-platform-clients/ad-platform-client.interface.js";

/**
 * Narrow, injectable Prisma-like dependency interface — mirrors
 * sales-import.service.ts's approach (real DB calls through a small,
 * mockable surface) so this whole sync pipeline is unit-testable with a
 * fake platform client, no live DB or real ad-platform network call.
 */
export interface AdSyncPrismaDeps {
  adAccountConnection: {
    findUnique(args: any): Promise<any | null>;
    update(args: any): Promise<any>;
  };
  adCampaign: {
    findFirst(args: any): Promise<any | null>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  adSpendRecord: {
    findFirst(args: any): Promise<any | null>;
    create(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
}

export interface SyncCampaignsResult {
  campaignsSynced: number;
  spendRecordsSynced: number;
  errors: string[];
}

function sourceForPlatform(platform: AdPlatform): "META_SYNC" | "GOOGLE_SYNC" {
  return platform === "META" ? "META_SYNC" : "GOOGLE_SYNC";
}

/**
 * Pulls real campaigns+spend from the connected platform and upserts them —
 * batch-record-with-per-row-error-collection shape, mirroring
 * sales-import.service.ts exactly: one bad row never aborts the whole sync,
 * and every failure is recorded with a clear message rather than silently
 * dropped or guessed. Campaigns are keyed on (companyId, platform,
 * externalCampaignId); spend records are keyed on (campaignId, date) —
 * matched manually via findFirst+create/update since AdSpendRecord has no
 * DB-level unique constraint on that pair (only an index), so re-syncing
 * the same day never creates a duplicate row.
 */
export async function syncCampaignsFromPlatform(
  deps: AdSyncPrismaDeps,
  platformClient: AdPlatformClient,
  companyId: string,
  platform: AdPlatform,
): Promise<SyncCampaignsResult> {
  const connection = await deps.adAccountConnection.findUnique({ where: { companyId_platform: { companyId, platform } } });
  if (!connection || connection.status !== "CONNECTED" || !connection.accessTokenEncrypted || !connection.externalAccountId) {
    throw new NotFoundError(`No connected ${platform} ad account for this company`);
  }

  const accessToken = decryptSecret(connection.accessTokenEncrypted);

  const insights: PlatformCampaignInsight[] = await platformClient.fetchCampaignsWithInsights(accessToken, connection.externalAccountId);

  const source = sourceForPlatform(platform);
  const errors: string[] = [];
  let campaignsSynced = 0;
  let spendRecordsSynced = 0;

  for (const insight of insights) {
    try {
      if (!insight.externalCampaignId || !insight.name || !insight.startDate) {
        errors.push("Skipped a campaign row with a missing externalCampaignId/name/startDate");
        continue;
      }
      const startDate = new Date(insight.startDate);
      if (Number.isNaN(startDate.getTime())) {
        errors.push(`Campaign ${insight.externalCampaignId}: invalid startDate "${insight.startDate}"`);
        continue;
      }
      const endDate = insight.endDate ? new Date(insight.endDate) : null;
      if (insight.endDate && Number.isNaN((endDate as Date).getTime())) {
        errors.push(`Campaign ${insight.externalCampaignId}: invalid endDate "${insight.endDate}"`);
        continue;
      }

      let campaign = await deps.adCampaign.findFirst({ where: { companyId, platform, externalCampaignId: insight.externalCampaignId } });
      if (campaign) {
        campaign = await deps.adCampaign.update({
          where: { id: campaign.id },
          data: { name: insight.name, startDate, endDate, isActive: insight.isActive, source },
        });
      } else {
        campaign = await deps.adCampaign.create({
          data: { companyId, platform, source, externalCampaignId: insight.externalCampaignId, name: insight.name, startDate, endDate, isActive: insight.isActive },
        });
      }
      campaignsSynced += 1;

      for (const spend of insight.spendByDate) {
        try {
          const spendDate = new Date(spend.date);
          if (Number.isNaN(spendDate.getTime())) {
            errors.push(`Campaign ${insight.externalCampaignId}: invalid spend date "${spend.date}"`);
            continue;
          }
          const existingSpend = await deps.adSpendRecord.findFirst({ where: { campaignId: campaign.id, date: spendDate } });
          if (existingSpend) {
            await deps.adSpendRecord.update({
              where: { id: existingSpend.id },
              data: { amount: spend.amount, impressions: spend.impressions, clicks: spend.clicks, source },
            });
          } else {
            await deps.adSpendRecord.create({
              data: { campaignId: campaign.id, date: spendDate, amount: spend.amount, impressions: spend.impressions, clicks: spend.clicks, source },
            });
          }
          spendRecordsSynced += 1;
        } catch (err) {
          errors.push(`Campaign ${insight.externalCampaignId}, spend date ${spend.date}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      errors.push(`Campaign ${insight.externalCampaignId ?? "unknown"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await deps.adAccountConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date() } });

  return { campaignsSynced, spendRecordsSynced, errors };
}

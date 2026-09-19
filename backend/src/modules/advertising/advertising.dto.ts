/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AdConnectionDTO, AdCampaignDTO, AdSpendRecordDTO, AdPlatform } from "@ai-sales/shared";

export function toAdCampaignDTO(campaign: any): AdCampaignDTO {
  return {
    id: campaign.id,
    platform: campaign.platform,
    source: campaign.source,
    name: campaign.name,
    startDate: (campaign.startDate instanceof Date ? campaign.startDate : new Date(campaign.startDate)).toISOString(),
    endDate: campaign.endDate ? (campaign.endDate instanceof Date ? campaign.endDate : new Date(campaign.endDate)).toISOString() : null,
    isActive: campaign.isActive,
    createdAt: (campaign.createdAt instanceof Date ? campaign.createdAt : new Date(campaign.createdAt)).toISOString(),
  };
}

export function toAdSpendRecordDTO(record: any): AdSpendRecordDTO {
  return {
    id: record.id,
    campaignId: record.campaignId,
    date: (record.date instanceof Date ? record.date : new Date(record.date)).toISOString(),
    amount: record.amount.toString(),
    impressions: record.impressions ?? null,
    clicks: record.clicks ?? null,
    source: record.source,
  };
}

/**
 * `configured` is passed in explicitly by the caller (from
 * platform-client.factory.ts's isPlatformConfigured) rather than looked up
 * here — this function stays pure/DB-row-shaped, with no env access of its
 * own.
 */
export function toAdConnectionDTO(platform: AdPlatform, row: any, configured: boolean): AdConnectionDTO {
  return {
    platform,
    status: row.status,
    externalAccountId: row.externalAccountId ?? null,
    lastSyncedAt: row.lastSyncedAt ? (row.lastSyncedAt instanceof Date ? row.lastSyncedAt : new Date(row.lastSyncedAt)).toISOString() : null,
    connectedByUserName: row.connectedBy?.name ?? null,
    configured,
  };
}

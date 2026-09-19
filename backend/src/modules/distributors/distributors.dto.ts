/* eslint-disable @typescript-eslint/no-explicit-any */
import type { DistributorDTO } from "@ai-sales/shared";

export function toDistributorDTO(distributor: any): DistributorDTO {
  const territories: { stateId: string; state: { name: string } }[] = distributor.territories ?? [];
  return {
    id: distributor.id,
    name: distributor.name,
    type: distributor.type,
    status: distributor.status,
    contactEmail: distributor.contactEmail ?? null,
    contactPhone: distributor.contactPhone ?? null,
    assignedUserId: distributor.assignedUserId ?? null,
    assignedUserName: distributor.assignedUser?.name ?? null,
    stateIds: territories.map((t) => t.stateId),
    stateNames: territories.map((t) => t.state.name),
    onboardedAt: distributor.onboardedAt
      ? (distributor.onboardedAt instanceof Date ? distributor.onboardedAt : new Date(distributor.onboardedAt)).toISOString()
      : null,
    createdAt: (distributor.createdAt instanceof Date ? distributor.createdAt : new Date(distributor.createdAt)).toISOString(),
  };
}

import type { PrismaClient, State, City } from "@prisma/client";
import { NotFoundError } from "../../lib/errors.js";

export async function listStates(prisma: PrismaClient): Promise<State[]> {
  return prisma.state.findMany({ orderBy: { name: "asc" } });
}

export async function listCitiesForState(prisma: PrismaClient, stateId: string): Promise<City[]> {
  const state = await prisma.state.findUnique({ where: { id: stateId } });
  if (!state) {
    throw new NotFoundError("State not found");
  }
  return prisma.city.findMany({ where: { stateId }, orderBy: { name: "asc" } });
}

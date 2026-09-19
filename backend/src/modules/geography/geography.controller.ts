import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { toStateDTO, toCityDTO } from "../../lib/dto.js";
import * as geographyService from "./geography.service.js";

export async function listStates(_req: Request, res: Response): Promise<void> {
  const states = await geographyService.listStates(prisma);
  res.status(200).json(states.map(toStateDTO));
}

export async function listCitiesForState(req: Request, res: Response): Promise<void> {
  const cities = await geographyService.listCitiesForState(prisma, req.params.id);
  res.status(200).json(cities.map(toCityDTO));
}

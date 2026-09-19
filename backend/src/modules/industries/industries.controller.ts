import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { toIndustryDTO, toBusinessTypeDTO } from "../../lib/dto.js";
import * as industriesService from "./industries.service.js";

export async function listIndustries(_req: Request, res: Response): Promise<void> {
  const industries = await industriesService.listIndustries(prisma);
  res.status(200).json(industries.map(toIndustryDTO));
}

export async function listBusinessTypes(_req: Request, res: Response): Promise<void> {
  const businessTypes = await industriesService.listBusinessTypes(prisma);
  res.status(200).json(businessTypes.map(toBusinessTypeDTO));
}

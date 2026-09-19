import type { Request, Response } from "express";
import { BadRequestError, UnauthorizedError } from "../../lib/errors.js";
import { getFmsClient } from "./fms-client.factory.js";
import * as fmsService from "./fms.service.js";
import type { FmsDataQuery } from "./fms.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function getData(req: Request, res: Response): Promise<void> {
  requireUser(req);
  const { sheet, limit } = req.query as unknown as FmsDataQuery;

  const client = getFmsClient();
  if (!client) {
    res.status(200).json({
      configured: false,
      message: "FMS integration is not configured on this server. Set FMS_API_URL to enable it.",
    });
    return;
  }

  const result = await fmsService.getFmsData(client, { sheet, limit });

  if (result.status === "bad_request") {
    throw new BadRequestError(`The FMS API rejected this request: ${result.error}`, { allowedSheets: result.allowedSheets });
  }
  if (result.status === "upstream_error") {
    res.status(502).json({ error: { message: "Failed to fetch data from the FMS API", details: result.message } });
    return;
  }

  res.status(200).json(result.dto);
}

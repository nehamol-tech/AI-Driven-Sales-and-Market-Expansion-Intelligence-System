import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { getCachedFmsClient } from "./fms-client.factory.js";
import * as fmsFulfilmentService from "./fms-fulfilment.service.js";
import type { FmsFulfilmentQuery } from "./fms.schema.js";

/**
 * GET /api/fms/fulfilment — read-only. Same `configured:false` and 502
 * conventions as fms.controller.ts's getData. A sheet whose layout can't be
 * validated is also a 502: the upstream data isn't in a shape this view can
 * trust, and the specific problems are returned rather than guessed around.
 */
export async function getFulfilment(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  const { page, pageSize } = req.query as unknown as FmsFulfilmentQuery;

  const client = getCachedFmsClient();
  if (!client) {
    res.status(200).json({
      configured: false,
      message: "FMS integration is not configured on this server. Set FMS_API_URL to enable it.",
    });
    return;
  }

  const result = await fmsFulfilmentService.getOrderFulfilment(prisma, client, req.user.companyId, { page, pageSize });

  if (result.status === "upstream_error") {
    res.status(502).json({ error: { message: "Failed to fetch data from the FMS API", details: result.message } });
    return;
  }
  if (result.status === "layout_invalid") {
    res.status(502).json({
      error: { message: "The FMS sheet's layout was not recognised", details: { problems: result.problems } },
    });
    return;
  }

  res.status(200).json(result.dto);
}

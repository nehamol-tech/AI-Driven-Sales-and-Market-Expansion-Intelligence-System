import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { logAudit } from "../audit/audit.service.js";
import * as feedbackService from "./feedback.service.js";
import type { LeadFeedbackParams, SubmitFeedbackInput } from "./feedback.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function submitFeedback(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { leadType, id } = req.params as unknown as LeadFeedbackParams;
  const input = req.body as SubmitFeedbackInput;

  const feedback = await feedbackService.submitLeadFeedback(prisma, user.companyId, leadType, id, user.id, input);

  await logAudit({
    userId: user.id,
    action: "LEAD_SCORE_FEEDBACK_SUBMITTED",
    entityType: leadType === "accounts" ? "Account" : "Prospect",
    entityId: id,
    metadata: { leadScoreId: feedback.leadScoreId, rating: feedback.rating },
    ipAddress: req.ip ?? null,
  });

  res.status(201).json(feedback);
}

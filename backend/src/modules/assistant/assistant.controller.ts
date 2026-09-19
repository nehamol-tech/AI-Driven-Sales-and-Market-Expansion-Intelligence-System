import type { Request, Response } from "express";
import { prisma } from "../../lib/prisma.js";
import { UnauthorizedError } from "../../lib/errors.js";
import { createAIProvider } from "../../lib/ai/ai-provider.factory.js";
import { logAudit } from "../audit/audit.service.js";
import * as assistantService from "./assistant.service.js";
import type { AssistantAskBody } from "./assistant.schema.js";

function requireUser(req: Request): { id: string; role: string; companyId: string } {
  if (!req.user) {
    throw new UnauthorizedError("Authentication required");
  }
  return req.user;
}

export async function ask(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const body = req.body as AssistantAskBody;

  const aiProvider = createAIProvider();
  const dto = await assistantService.askAssistant(prisma, aiProvider, {
    companyId: user.companyId,
    question: body.question,
  });

  // No real action occurred for an unmatched question (no data fetched, no AI called) — nothing to audit.
  if (dto.matchedIntentId) {
    await logAudit({
      userId: user.id,
      action: "ASSISTANT_QUESTION_ANSWERED",
      entityType: "AssistantAnswer",
      entityId: null,
      metadata: {
        companyId: user.companyId,
        matchedIntentId: dto.matchedIntentId,
        method: dto.method,
        resultCount: dto.results.length,
      },
      ipAddress: req.ip ?? null,
    });
  }

  res.status(200).json(dto);
}

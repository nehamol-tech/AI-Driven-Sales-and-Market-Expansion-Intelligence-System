import type { PrismaClient } from "@prisma/client";
import type { LeadScoreFeedbackDTO, LeadType } from "@ai-sales/shared";
import { NotFoundError } from "../../lib/errors.js";
import { toLeadScoreFeedbackDTO } from "./leads.dto.js";
import type { SubmitFeedbackInput } from "./feedback.schema.js";

/**
 * Feedback is submitted against a lead (account/prospect id) but always
 * persisted against that lead's current latest LeadScore row, so it stays
 * tied to the exact score version it was given on even as the lead gets
 * rescored later.
 */
export async function submitLeadFeedback(
  prisma: PrismaClient,
  companyId: string,
  leadType: LeadType,
  leadId: string,
  userId: string,
  input: SubmitFeedbackInput,
): Promise<LeadScoreFeedbackDTO> {
  const latestScore = await prisma.leadScore.findFirst({
    where: {
      companyId,
      isLatest: true,
      ...(leadType === "accounts" ? { accountId: leadId } : { prospectId: leadId }),
    },
  });

  if (!latestScore) {
    throw new NotFoundError("No score exists yet for this lead — feedback requires an existing score");
  }

  const feedback = await prisma.leadScoreFeedback.create({
    data: {
      leadScoreId: latestScore.id,
      userId,
      rating: input.rating,
      comment: input.comment ?? null,
    },
    include: { user: { select: { name: true } } },
  });

  return toLeadScoreFeedbackDTO(feedback);
}

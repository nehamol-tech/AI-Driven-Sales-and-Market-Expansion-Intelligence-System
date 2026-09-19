import rateLimit from "express-rate-limit";
import type { ApiErrorResponse } from "@ai-sales/shared";
import { LOGIN_RATE_LIMIT, BOOTSTRAP_RATE_LIMIT, LEAD_SCORING_RATE_LIMIT, ASSISTANT_RATE_LIMIT } from "../config/constants.js";

const tooManyRequestsBody: ApiErrorResponse = {
  error: { message: "Too many requests. Please try again later." },
};

export const loginRateLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT.windowMs,
  max: LOGIN_RATE_LIMIT.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooManyRequestsBody,
});

export const bootstrapRateLimiter = rateLimit({
  windowMs: BOOTSTRAP_RATE_LIMIT.windowMs,
  max: BOOTSTRAP_RATE_LIMIT.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooManyRequestsBody,
});

/** Guards the score-triggering lead endpoints — AI calls cost money. */
export const leadScoringRateLimiter = rateLimit({
  windowMs: LEAD_SCORING_RATE_LIMIT.windowMs,
  max: LEAD_SCORING_RATE_LIMIT.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooManyRequestsBody,
});

/** Guards POST /api/assistant/ask — there's no daily cache here (unlike sales-agent/today), so this rate limit is the primary cost/abuse control. */
export const assistantRateLimiter = rateLimit({
  windowMs: ASSISTANT_RATE_LIMIT.windowMs,
  max: ASSISTANT_RATE_LIMIT.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: tooManyRequestsBody,
});

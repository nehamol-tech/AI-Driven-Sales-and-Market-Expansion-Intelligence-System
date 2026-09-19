export const SESSION_COOKIE_NAME = "asee_session";

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const CSV_IMPORT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 10,
};

export const BOOTSTRAP_RATE_LIMIT = {
  windowMs: 60 * 60 * 1000,
  max: 5,
};

/** Applies to the score-triggering lead endpoints (cost control — AI calls cost money). */
export const LEAD_SCORING_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 20,
};

export const LEAD_SCORE_BATCH_MAX = 25;

/**
 * Guards POST /api/assistant/ask. Unlike sales-agent/today, there's no
 * daily cache backing this endpoint — every question is a fresh AI call, so
 * the rate limit itself is what bounds the cost/abuse surface. 30 requests
 * per 15 minutes is generous enough for normal interactive chat use (a rep
 * asking several questions back-to-back) while still capping the worst case
 * well below what an unbounded script could otherwise trigger.
 */
export const ASSISTANT_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  max: 30,
};

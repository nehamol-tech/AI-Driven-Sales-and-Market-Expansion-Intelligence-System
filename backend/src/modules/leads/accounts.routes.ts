import { Router } from "express";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { leadScoringRateLimiter } from "../../middleware/rate-limit.middleware.js";
import { listAccountsQuerySchema, accountIdParamSchema, triggerScoreSchema } from "./accounts.schema.js";
import * as accountsController from "./accounts.controller.js";

const router = Router();

router.get("/", validate({ query: listAccountsQuerySchema }), asyncHandler(accountsController.listAccounts));

router.get("/:id", validate({ params: accountIdParamSchema }), asyncHandler(accountsController.getAccount));

router.post(
  "/:id/score",
  requireRole("ADMIN", "MANAGER"),
  leadScoringRateLimiter,
  validate({ params: accountIdParamSchema, body: triggerScoreSchema }),
  asyncHandler(accountsController.scoreAccount),
);

export default router;

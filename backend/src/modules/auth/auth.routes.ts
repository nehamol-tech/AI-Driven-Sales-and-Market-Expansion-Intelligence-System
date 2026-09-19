import { Router } from "express";
import { validate } from "../../middleware/validate.middleware.js";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { loginRateLimiter, bootstrapRateLimiter } from "../../middleware/rate-limit.middleware.js";
import { bootstrapSchema, loginSchema } from "./auth.schema.js";
import * as authController from "./auth.controller.js";
import { asyncHandler } from "../../lib/async-handler.js";

const router = Router();

router.get("/bootstrap-status", asyncHandler(authController.bootstrapStatus));

router.post(
  "/bootstrap",
  bootstrapRateLimiter,
  validate({ body: bootstrapSchema }),
  asyncHandler(authController.bootstrap),
);

router.post("/login", loginRateLimiter, validate({ body: loginSchema }), asyncHandler(authController.login));

router.post("/logout", requireAuth, authController.logout);

router.get("/me", requireAuth, asyncHandler(authController.me));

export default router;

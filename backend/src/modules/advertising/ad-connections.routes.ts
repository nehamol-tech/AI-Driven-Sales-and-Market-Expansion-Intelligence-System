import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { adPlatformParamSchema, oauthCallbackQuerySchema } from "./ad-connections.schema.js";
import * as adConnectionsController from "./ad-connections.controller.js";

const router = Router();

router.use(requireAuth);

// Open to every authenticated role — same risk profile as viewing any other read-only dashboard.
router.get("/", asyncHandler(adConnectionsController.list));

// Connecting/disconnecting real OAuth credentials is more sensitive than the
// usual ADMIN/MANAGER force-gate pattern elsewhere in this app — ADMIN-only,
// matching users.routes.ts's exact precedent.
router.post("/:platform/authorize", requireRole("ADMIN"), validate({ params: adPlatformParamSchema }), asyncHandler(adConnectionsController.authorize));

router.get(
  "/:platform/callback",
  requireRole("ADMIN"),
  validate({ params: adPlatformParamSchema, query: oauthCallbackQuerySchema }),
  asyncHandler(adConnectionsController.callback),
);

router.delete("/:platform", requireRole("ADMIN"), validate({ params: adPlatformParamSchema }), asyncHandler(adConnectionsController.disconnect));

// Reading real ad data isn't as sensitive as connecting credentials — matches the more common ADMIN/MANAGER precedent used elsewhere (e.g. deletes, force-regenerate).
router.post("/:platform/sync", requireRole("ADMIN", "MANAGER"), validate({ params: adPlatformParamSchema }), asyncHandler(adConnectionsController.sync));

export default router;

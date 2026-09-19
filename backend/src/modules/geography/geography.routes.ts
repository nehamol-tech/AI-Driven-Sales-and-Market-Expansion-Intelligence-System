import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { stateIdParamSchema } from "./geography.schema.js";
import * as geographyController from "./geography.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/states", asyncHandler(geographyController.listStates));
router.get(
  "/states/:id/cities",
  validate({ params: stateIdParamSchema }),
  asyncHandler(geographyController.listCitiesForState),
);

export default router;

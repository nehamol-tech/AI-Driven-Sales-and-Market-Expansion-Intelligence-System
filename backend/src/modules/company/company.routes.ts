import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import {
  updateCompanySchema,
  operatingStateSchema,
  targetStateSchema,
  deleteTargetStateSchema,
} from "./company.schema.js";
import * as companyController from "./company.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(companyController.getCompany));

router.put(
  "/",
  requireRole("ADMIN"),
  validate({ body: updateCompanySchema }),
  asyncHandler(companyController.updateCompany),
);

router.post(
  "/operating-states",
  requireRole("ADMIN"),
  validate({ body: operatingStateSchema }),
  asyncHandler(companyController.addOperatingState),
);

router.delete(
  "/operating-states",
  requireRole("ADMIN"),
  validate({ body: operatingStateSchema }),
  asyncHandler(companyController.removeOperatingState),
);

router.post(
  "/target-states",
  requireRole("ADMIN"),
  validate({ body: targetStateSchema }),
  asyncHandler(companyController.addTargetState),
);

router.delete(
  "/target-states",
  requireRole("ADMIN"),
  validate({ body: deleteTargetStateSchema }),
  asyncHandler(companyController.removeTargetState),
);

export default router;

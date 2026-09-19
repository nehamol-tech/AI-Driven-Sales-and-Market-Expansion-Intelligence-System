import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { createUserSchema, updateUserSchema, userIdParamSchema } from "./users.schema.js";
import * as usersController from "./users.controller.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));

router.get("/", asyncHandler(usersController.listUsers));

router.post("/", validate({ body: createUserSchema }), asyncHandler(usersController.createUser));

router.patch(
  "/:id",
  validate({ params: userIdParamSchema, body: updateUserSchema }),
  asyncHandler(usersController.updateUser),
);

router.delete("/:id", validate({ params: userIdParamSchema }), asyncHandler(usersController.deactivateUser));

export default router;

import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import {
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
  productIdParamSchema,
} from "./products.schema.js";
import * as productsController from "./products.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", validate({ query: listProductsQuerySchema }), asyncHandler(productsController.listProducts));

router.get("/:id", validate({ params: productIdParamSchema }), asyncHandler(productsController.getProduct));

router.post(
  "/",
  requireRole("ADMIN", "MANAGER"),
  validate({ body: createProductSchema }),
  asyncHandler(productsController.createProduct),
);

router.put(
  "/:id",
  requireRole("ADMIN", "MANAGER"),
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  asyncHandler(productsController.updateProduct),
);

router.delete(
  "/:id",
  requireRole("ADMIN", "MANAGER"),
  validate({ params: productIdParamSchema }),
  asyncHandler(productsController.deleteProduct),
);

export default router;

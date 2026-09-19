import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { CSV_IMPORT_MAX_FILE_SIZE_BYTES } from "../../config/constants.js";
import {
  createSalesRecordSchema,
  updateSalesRecordSchema,
  listSalesQuerySchema,
  salesRecordIdParamSchema,
  importBatchIdParamSchema,
} from "./sales.schema.js";
import * as salesController from "./sales.controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CSV_IMPORT_MAX_FILE_SIZE_BYTES },
});

const router = Router();

router.use(requireAuth);

router.get("/", validate({ query: listSalesQuerySchema }), asyncHandler(salesController.listSales));

router.post(
  "/import",
  upload.single("file"),
  asyncHandler(salesController.importSalesCsv),
);

router.get(
  "/import/:batchId",
  validate({ params: importBatchIdParamSchema }),
  asyncHandler(salesController.getImportBatch),
);

router.get("/:id", validate({ params: salesRecordIdParamSchema }), asyncHandler(salesController.getSalesRecord));

router.post("/", validate({ body: createSalesRecordSchema }), asyncHandler(salesController.createSalesRecord));

router.put(
  "/:id",
  validate({ params: salesRecordIdParamSchema, body: updateSalesRecordSchema }),
  asyncHandler(salesController.updateSalesRecord),
);

router.delete(
  "/:id",
  validate({ params: salesRecordIdParamSchema }),
  asyncHandler(salesController.deleteSalesRecord),
);

export default router;

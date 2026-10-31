import { Router } from "express";
import { requireAuth } from "../../middleware/auth.middleware.js";
import { requireRole } from "../../middleware/role.middleware.js";
import { validate } from "../../middleware/validate.middleware.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { fmsDataQuerySchema, fmsFulfilmentQuerySchema } from "./fms.schema.js";
import * as fmsController from "./fms.controller.js";
import * as fmsFulfilmentController from "./fms-fulfilment.controller.js";

const router = Router();

router.use(requireAuth);

// Read-only proxy to the FMS Google Sheet via its Apps Script Web App — same
// risk profile as viewing any other read-only dashboard/analytics endpoint,
// so it's open to every authenticated role (mirrors ad-connections.routes.ts's
// GET / precedent: "Open to every authenticated role — same risk profile as
// viewing any other read-only dashboard").
router.get("/data", validate({ query: fmsDataQuerySchema }), asyncHandler(fmsController.getData));

// Read-only Order Fulfilment view (FMS sheet workflow steps joined to
// existing synced SalesRecords) — same read-only risk profile and the same
// customer-level detail as /data, so the same open-to-every-authenticated-role
// precedent applies. Reads only; never syncs or writes.
router.get(
  "/fulfilment",
  validate({ query: fmsFulfilmentQuerySchema }),
  asyncHandler(fmsFulfilmentController.getFulfilment),
);

// Writes real SalesRecord/Account rows into this company's data — ADMIN-only,
// matching ad-connections.routes.ts's precedent for actions more sensitive
// than a plain read (there, connecting/disconnecting credentials; here,
// creating real business records). Still never writes anything back to the
// FMS Google Sheet itself — only reads from it (via the unmodified FmsClient)
// and writes to this app's own Postgres database.
router.post("/sync", requireRole("ADMIN"), asyncHandler(fmsController.syncOrders));

// Historical import from the larger "FMS Response" sheet (Phase 4) — same
// ADMIN-only precedent as /sync, and same read-only-toward-FMS guarantee:
// only reads via the unmodified FmsClient, only writes to Postgres.
router.post("/sync-history", requireRole("ADMIN"), asyncHandler(fmsController.syncOrderHistory));

export default router;

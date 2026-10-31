-- AlterTable
ALTER TABLE "SalesRecord" ADD COLUMN     "externalRef" TEXT,
ADD COLUMN     "metadata" JSONB;

-- CreateIndex
-- Safe against existing rows: every current SalesRecord (all MANUAL/
-- CSV_IMPORT/FMS_SYNC) has externalRef = NULL after the ALTER TABLE above,
-- and Postgres never treats two NULLs as colliding under a unique index —
-- so this cannot fail against existing data, only against a genuine future
-- duplicate (companyId, source, externalRef) triple.
CREATE UNIQUE INDEX "SalesRecord_companyId_source_externalRef_key" ON "SalesRecord"("companyId", "source", "externalRef");

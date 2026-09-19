-- CreateEnum
CREATE TYPE "DistributorType" AS ENUM ('DISTRIBUTOR', 'DEALER');

-- CreateEnum
CREATE TYPE "DistributorStatus" AS ENUM ('PROSPECTIVE', 'ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "SalesRecord" ADD COLUMN     "distributorId" TEXT;

-- CreateTable
CREATE TABLE "Distributor" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DistributorType" NOT NULL,
    "status" "DistributorStatus" NOT NULL DEFAULT 'PROSPECTIVE',
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "assignedUserId" TEXT,
    "createdById" TEXT,
    "onboardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Distributor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributorTerritory" (
    "distributorId" TEXT NOT NULL,
    "stateId" TEXT NOT NULL,

    CONSTRAINT "DistributorTerritory_pkey" PRIMARY KEY ("distributorId","stateId")
);

-- CreateIndex
CREATE INDEX "Distributor_companyId_idx" ON "Distributor"("companyId");

-- CreateIndex
CREATE INDEX "SalesRecord_distributorId_idx" ON "SalesRecord"("distributorId");

-- AddForeignKey
ALTER TABLE "SalesRecord" ADD CONSTRAINT "SalesRecord_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Distributor" ADD CONSTRAINT "Distributor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributorTerritory" ADD CONSTRAINT "DistributorTerritory_distributorId_fkey" FOREIGN KEY ("distributorId") REFERENCES "Distributor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributorTerritory" ADD CONSTRAINT "DistributorTerritory_stateId_fkey" FOREIGN KEY ("stateId") REFERENCES "State"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


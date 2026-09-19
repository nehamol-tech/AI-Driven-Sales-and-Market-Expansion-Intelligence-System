-- CreateEnum
CREATE TYPE "OptimizationRecommendationType" AS ENUM ('SCHEDULE_FOLLOW_UP', 'AT_RISK_FOLLOW_UP', 'PAUSE_UNDERPERFORMING_CAMPAIGN', 'DISTRIBUTOR_EXPANSION_ADVISORY');

-- CreateEnum
CREATE TYPE "OptimizationRecommendationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'EXECUTION_FAILED');

-- CreateEnum
CREATE TYPE "OptimizationTargetType" AS ENUM ('ACCOUNT', 'PROSPECT', 'AD_CAMPAIGN', 'STATE');

-- CreateTable
CREATE TABLE "OptimizationRecommendation" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "OptimizationRecommendationType" NOT NULL,
    "status" "OptimizationRecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "targetType" "OptimizationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionParams" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "narrative" TEXT,
    "narrativeMethod" "ScoreMethod" NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "executionResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OptimizationRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OptimizationRecommendation_companyId_status_idx" ON "OptimizationRecommendation"("companyId", "status");

-- CreateIndex
CREATE INDEX "OptimizationRecommendation_companyId_type_targetType_target_idx" ON "OptimizationRecommendation"("companyId", "type", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "OptimizationRecommendation" ADD CONSTRAINT "OptimizationRecommendation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationRecommendation" ADD CONSTRAINT "OptimizationRecommendation_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

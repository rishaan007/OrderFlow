-- CreateEnum
CREATE TYPE "DisputeCategory" AS ENUM ('ITEM_NOT_RECEIVED', 'ITEM_NOT_AS_DESCRIBED', 'DAMAGED_ITEM', 'WRONG_ITEM', 'PAYMENT_DISPUTE', 'REFUND_NOT_RECEIVED', 'DUPLICATE_PAYMENT', 'SELLER_NON_FULFILLMENT', 'BUYER_NON_PAYMENT', 'DELIVERY_DISPUTE', 'OTHER');

-- CreateEnum
CREATE TYPE "DisputeDecisionRecommendation" AS ENUM ('INSUFFICIENT_EVIDENCE', 'BUYER_EVIDENCE_REQUIRED', 'SELLER_EVIDENCE_REQUIRED', 'READY_FOR_REVIEW');

-- CreateEnum
CREATE TYPE "TrustSignalCategory" AS ENUM ('IDENTITY', 'PAYMENT', 'FULFILLMENT', 'DELIVERY', 'COMMUNICATION', 'DISPUTE', 'REFUND', 'RETURN', 'ORDER_HISTORY', 'ACCOUNT_SECURITY', 'TRANSACTION');

-- CreateEnum
CREATE TYPE "TrustSignalDirection" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "TrustSignalSeverity" AS ENUM ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TransactionRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "RiskReviewStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'DISMISSED', 'ESCALATED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DisputeStatus" ADD VALUE 'OPEN';
ALTER TYPE "DisputeStatus" ADD VALUE 'EVIDENCE_REQUESTED';
ALTER TYPE "DisputeStatus" ADD VALUE 'EVIDENCE_SUBMITTED';
ALTER TYPE "DisputeStatus" ADD VALUE 'DECISION_PENDING';
ALTER TYPE "DisputeStatus" ADD VALUE 'RESOLVED';
ALTER TYPE "DisputeStatus" ADD VALUE 'ESCALATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EvidenceType" ADD VALUE 'COMMUNICATION_TRANSCRIPT';
ALTER TYPE "EvidenceType" ADD VALUE 'REFUND_PROOF';
ALTER TYPE "EvidenceType" ADD VALUE 'RETURN_TRACKING';

-- AlterTable
ALTER TABLE "transaction_disputes" ADD COLUMN     "category" "DisputeCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "claimantId" TEXT,
ADD COLUMN     "claimantType" TEXT NOT NULL DEFAULT 'BUYER',
ADD COLUMN     "decisionRecommendation" "DisputeDecisionRecommendation",
ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "evidenceRequestedAt" TIMESTAMP(3),
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "resolutionReason" TEXT,
ADD COLUMN     "resolvedByUserId" TEXT;

-- AlterTable
ALTER TABLE "transaction_evidence" ADD COLUMN     "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "disputeId" TEXT;

-- CreateTable
CREATE TABLE "trust_signals" (
    "id" TEXT NOT NULL,
    "buyerIdentityId" TEXT,
    "businessId" TEXT,
    "socialTransactionId" TEXT,
    "orderId" TEXT,
    "disputeId" TEXT,
    "signalType" TEXT NOT NULL,
    "category" "TrustSignalCategory" NOT NULL,
    "direction" "TrustSignalDirection" NOT NULL,
    "severity" "TrustSignalSeverity" NOT NULL,
    "scoreValue" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "explanation" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "sampleSize" INTEGER,
    "observationWindow" TEXT,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "invalidationReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trust_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_risk_assessments" (
    "id" TEXT NOT NULL,
    "socialTransactionId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "buyerIdentityId" TEXT,
    "riskLevel" "TransactionRiskLevel" NOT NULL DEFAULT 'LOW',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL,
    "evaluatedSignals" JSONB,
    "modelVersion" TEXT NOT NULL DEFAULT 'v1',
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_reviews" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "RiskReviewStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "decision" TEXT,
    "notes" TEXT,
    "reason" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "risk_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trust_risk_audit_events" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "buyerIdentityId" TEXT,
    "transactionId" TEXT,
    "assessmentId" TEXT,
    "disputeId" TEXT,
    "eventType" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "previousState" JSONB,
    "newState" JSONB,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trust_risk_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trust_signals_buyerIdentityId_observedAt_idx" ON "trust_signals"("buyerIdentityId", "observedAt");

-- CreateIndex
CREATE INDEX "trust_signals_businessId_observedAt_idx" ON "trust_signals"("businessId", "observedAt");

-- CreateIndex
CREATE INDEX "trust_signals_socialTransactionId_idx" ON "trust_signals"("socialTransactionId");

-- CreateIndex
CREATE INDEX "trust_signals_orderId_idx" ON "trust_signals"("orderId");

-- CreateIndex
CREATE INDEX "trust_signals_disputeId_idx" ON "trust_signals"("disputeId");

-- CreateIndex
CREATE INDEX "trust_signals_category_direction_idx" ON "trust_signals"("category", "direction");

-- CreateIndex
CREATE INDEX "trust_signals_signalType_idx" ON "trust_signals"("signalType");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_risk_assessments_socialTransactionId_key" ON "transaction_risk_assessments"("socialTransactionId");

-- CreateIndex
CREATE INDEX "transaction_risk_assessments_businessId_riskLevel_idx" ON "transaction_risk_assessments"("businessId", "riskLevel");

-- CreateIndex
CREATE INDEX "transaction_risk_assessments_buyerIdentityId_idx" ON "transaction_risk_assessments"("buyerIdentityId");

-- CreateIndex
CREATE INDEX "transaction_risk_assessments_riskLevel_assessedAt_idx" ON "transaction_risk_assessments"("riskLevel", "assessedAt");

-- CreateIndex
CREATE INDEX "risk_reviews_businessId_status_idx" ON "risk_reviews"("businessId", "status");

-- CreateIndex
CREATE INDEX "risk_reviews_assessmentId_idx" ON "risk_reviews"("assessmentId");

-- CreateIndex
CREATE INDEX "trust_risk_audit_events_businessId_createdAt_idx" ON "trust_risk_audit_events"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "trust_risk_audit_events_buyerIdentityId_createdAt_idx" ON "trust_risk_audit_events"("buyerIdentityId", "createdAt");

-- CreateIndex
CREATE INDEX "trust_risk_audit_events_transactionId_idx" ON "trust_risk_audit_events"("transactionId");

-- CreateIndex
CREATE INDEX "trust_risk_audit_events_disputeId_idx" ON "trust_risk_audit_events"("disputeId");

-- CreateIndex
CREATE INDEX "trust_risk_audit_events_eventType_idx" ON "trust_risk_audit_events"("eventType");

-- CreateIndex
CREATE INDEX "transaction_disputes_category_idx" ON "transaction_disputes"("category");

-- CreateIndex
CREATE INDEX "transaction_evidence_disputeId_idx" ON "transaction_evidence"("disputeId");

-- AddForeignKey
ALTER TABLE "transaction_evidence" ADD CONSTRAINT "transaction_evidence_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "transaction_disputes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_signals" ADD CONSTRAINT "trust_signals_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_signals" ADD CONSTRAINT "trust_signals_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_signals" ADD CONSTRAINT "trust_signals_socialTransactionId_fkey" FOREIGN KEY ("socialTransactionId") REFERENCES "social_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_signals" ADD CONSTRAINT "trust_signals_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trust_signals" ADD CONSTRAINT "trust_signals_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "transaction_disputes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_risk_assessments" ADD CONSTRAINT "transaction_risk_assessments_socialTransactionId_fkey" FOREIGN KEY ("socialTransactionId") REFERENCES "social_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_risk_assessments" ADD CONSTRAINT "transaction_risk_assessments_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_risk_assessments" ADD CONSTRAINT "transaction_risk_assessments_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "transaction_risk_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

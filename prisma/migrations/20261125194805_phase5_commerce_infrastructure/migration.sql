-- CreateEnum
CREATE TYPE "FulfillmentStatus" AS ENUM ('UNFULFILLED', 'ALLOCATED', 'PACKED', 'DISPATCHED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_ATTEMPT', 'RETURNED_TO_ORIGIN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'PARTIALLY_CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('RAZORPAY', 'STRIPE', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RefundType" AS ENUM ('FULL_REFUND', 'PARTIAL_REFUND', 'CANCELLATION_REFUND', 'RETURN_REFUND', 'DISPUTE_REFUND', 'MANUAL_REFUND');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'LABEL_CREATED', 'IN_TRANSIT', 'RECEIVED', 'INSPECTED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('WRONG_ITEM', 'DAMAGED_ITEM', 'ITEM_NOT_AS_DESCRIBED', 'SIZE_ISSUE', 'CHANGED_MIND', 'DEFECTIVE_ITEM', 'MISSING_ITEM', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('PAYMENT_AUTHORIZED', 'PAYMENT_RECEIVED', 'PAYMENT_CAPTURED', 'REFUND_ISSUED', 'REFUND_COMPLETED', 'ADJUSTMENT', 'REVERSAL', 'FEE', 'SHIPPING_CHARGE', 'RETURN_CHARGE');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('MATCHED', 'MISSING_INTERNAL', 'MISSING_PROVIDER', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'DUPLICATE', 'UNKNOWN_PROVIDER_EVENT', 'STATE_MISMATCH');

-- CreateEnum
CREATE TYPE "ReconciliationType" AS ENUM ('PAYMENT', 'REFUND', 'SHIPMENT');

-- CreateEnum
CREATE TYPE "ProviderHealthStatus" AS ENUM ('CONNECTED', 'DEGRADED', 'AUTH_REQUIRED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DUPLICATE', 'IGNORED');

-- AlterEnum
ALTER TYPE "EvidenceType" ADD VALUE 'RETURN_INSPECTION';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentMethod" ADD VALUE 'RAZORPAY';
ALTER TYPE "PaymentMethod" ADD VALUE 'STRIPE';
ALTER TYPE "PaymentMethod" ADD VALUE 'WALLET';
ALTER TYPE "PaymentMethod" ADD VALUE 'NET_BANKING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ShipmentStatus" ADD VALUE 'CREATED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'LABEL_CREATED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'PICKUP_SCHEDULED';
ALTER TYPE "ShipmentStatus" ADD VALUE 'PICKED_UP';
ALTER TYPE "ShipmentStatus" ADD VALUE 'LOST';
ALTER TYPE "ShipmentStatus" ADD VALUE 'DAMAGED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "fulfillmentStatus" "FulfillmentStatus",
ADD COLUMN     "refundedAmountMinorUnits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnPolicy" JSONB;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "amountMinorUnits" INTEGER,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "paymentIntentId" TEXT,
ADD COLUMN     "provider" "PaymentProvider" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "providerPaymentId" TEXT;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "provider" TEXT,
ADD COLUMN     "providerShipmentId" TEXT;

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "socialTransactionId" TEXT,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MANUAL',
    "providerOrderId" TEXT,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "amountMinorUnits" INTEGER NOT NULL,
    "capturedMinorUnits" INTEGER NOT NULL DEFAULT 0,
    "refundedMinorUnits" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL DEFAULT 1,
    "provider" "PaymentProvider" NOT NULL,
    "providerPaymentId" TEXT,
    "providerOrderId" TEXT,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "method" "PaymentMethod",
    "failureCode" TEXT,
    "failureReason" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentId" TEXT,
    "paymentIntentId" TEXT,
    "socialTransactionId" TEXT,
    "returnRequestId" TEXT,
    "disputeId" TEXT,
    "type" "RefundType" NOT NULL DEFAULT 'MANUAL_REFUND',
    "status" "RefundStatus" NOT NULL DEFAULT 'REQUESTED',
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "reason" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'MANUAL',
    "providerRefundId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "processedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "socialTransactionId" TEXT,
    "customerId" TEXT,
    "buyerIdentityId" TEXT,
    "disputeId" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "ReturnReason" NOT NULL,
    "buyerNotes" TEXT,
    "sellerResponse" TEXT,
    "inspectionNotes" TEXT,
    "inspectionPassed" BOOLEAN,
    "policySnapshot" JSONB NOT NULL,
    "eligibilityResult" JSONB NOT NULL,
    "requestedAmountMinorUnits" INTEGER NOT NULL DEFAULT 0,
    "approvedAmountMinorUnits" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "trackingNumber" TEXT,
    "carrier" "DeliveryPartner",
    "returnLabelUrl" TEXT,
    "evidenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "inspectedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" TEXT NOT NULL,
    "returnRequestId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinorUnits" INTEGER NOT NULL,
    "reason" TEXT,
    "conditionNotes" TEXT,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "socialTransactionId" TEXT,
    "paymentId" TEXT,
    "paymentIntentId" TEXT,
    "refundId" TEXT,
    "transactionGroupId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL DEFAULT 1,
    "account" TEXT NOT NULL DEFAULT 'ORDER_RECEIVABLE',
    "entryType" "LedgerEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amountMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "reversesEntryId" TEXT,
    "provider" "PaymentProvider",
    "providerEventId" TEXT,
    "idempotencyKey" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_provider_configs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "accountIdentifier" TEXT,
    "encryptedCredentials" TEXT,
    "status" "ProviderHealthStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_webhook_events" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL DEFAULT 'PAYMENT',
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "businessId" TEXT,
    "signatureVerified" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingStatus" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "normalizedEntityType" TEXT,
    "normalizedEntityId" TEXT,
    "payload" JSONB NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT,
    "trackingNumber" TEXT,
    "status" "ShipmentStatus" NOT NULL,
    "rawStatus" TEXT,
    "description" TEXT,
    "location" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawEventData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_labels" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "trackingNumber" TEXT NOT NULL,
    "labelUrl" TEXT,
    "labelReference" TEXT,
    "format" TEXT NOT NULL DEFAULT 'PDF',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "ReconciliationType" NOT NULL,
    "provider" TEXT,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "mismatchCount" INTEGER NOT NULL DEFAULT 0,
    "unresolvedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "summary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_entries" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "status" "ReconciliationStatus" NOT NULL,
    "internalEntityType" TEXT,
    "internalEntityId" TEXT,
    "providerEntityId" TEXT,
    "expectedAmountMinorUnits" INTEGER,
    "actualAmountMinorUnits" INTEGER,
    "expectedCurrency" TEXT,
    "actualCurrency" TEXT,
    "expectedState" TEXT,
    "actualState" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_intents_businessId_status_idx" ON "payment_intents"("businessId", "status");

-- CreateIndex
CREATE INDEX "payment_intents_orderId_idx" ON "payment_intents"("orderId");

-- CreateIndex
CREATE INDEX "payment_intents_socialTransactionId_idx" ON "payment_intents"("socialTransactionId");

-- CreateIndex
CREATE INDEX "payment_intents_provider_providerOrderId_idx" ON "payment_intents"("provider", "providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_businessId_idempotencyKey_key" ON "payment_intents"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_attempts_paymentIntentId_idx" ON "payment_attempts"("paymentIntentId");

-- CreateIndex
CREATE INDEX "payment_attempts_businessId_idx" ON "payment_attempts"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_provider_providerPaymentId_key" ON "payment_attempts"("provider", "providerPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_paymentIntentId_idempotencyKey_key" ON "payment_attempts"("paymentIntentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "refunds_businessId_status_idx" ON "refunds"("businessId", "status");

-- CreateIndex
CREATE INDEX "refunds_orderId_idx" ON "refunds"("orderId");

-- CreateIndex
CREATE INDEX "refunds_paymentIntentId_idx" ON "refunds"("paymentIntentId");

-- CreateIndex
CREATE INDEX "refunds_returnRequestId_idx" ON "refunds"("returnRequestId");

-- CreateIndex
CREATE INDEX "refunds_provider_providerRefundId_idx" ON "refunds"("provider", "providerRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_businessId_idempotencyKey_key" ON "refunds"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "return_requests_businessId_status_idx" ON "return_requests"("businessId", "status");

-- CreateIndex
CREATE INDEX "return_requests_orderId_idx" ON "return_requests"("orderId");

-- CreateIndex
CREATE INDEX "return_requests_socialTransactionId_idx" ON "return_requests"("socialTransactionId");

-- CreateIndex
CREATE INDEX "return_requests_buyerIdentityId_idx" ON "return_requests"("buyerIdentityId");

-- CreateIndex
CREATE INDEX "return_items_returnRequestId_idx" ON "return_items"("returnRequestId");

-- CreateIndex
CREATE INDEX "return_items_orderItemId_idx" ON "return_items"("orderItemId");

-- CreateIndex
CREATE INDEX "ledger_entries_businessId_createdAt_idx" ON "ledger_entries"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_orderId_createdAt_idx" ON "ledger_entries"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_transactionGroupId_idx" ON "ledger_entries"("transactionGroupId");

-- CreateIndex
CREATE INDEX "ledger_entries_paymentIntentId_idx" ON "ledger_entries"("paymentIntentId");

-- CreateIndex
CREATE INDEX "ledger_entries_refundId_idx" ON "ledger_entries"("refundId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_businessId_idempotencyKey_key" ON "ledger_entries"("businessId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "payment_provider_configs_businessId_idx" ON "payment_provider_configs"("businessId");

-- CreateIndex
CREATE INDEX "payment_provider_configs_provider_accountIdentifier_idx" ON "payment_provider_configs"("provider", "accountIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_configs_businessId_provider_environment_key" ON "payment_provider_configs"("businessId", "provider", "environment");

-- CreateIndex
CREATE INDEX "provider_webhook_events_businessId_receivedAt_idx" ON "provider_webhook_events"("businessId", "receivedAt");

-- CreateIndex
CREATE INDEX "provider_webhook_events_domain_processingStatus_idx" ON "provider_webhook_events"("domain", "processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "provider_webhook_events_provider_providerEventId_key" ON "provider_webhook_events"("provider", "providerEventId");

-- CreateIndex
CREATE INDEX "tracking_events_shipmentId_occurredAt_idx" ON "tracking_events"("shipmentId", "occurredAt");

-- CreateIndex
CREATE INDEX "tracking_events_businessId_idx" ON "tracking_events"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "tracking_events_provider_providerEventId_key" ON "tracking_events"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_labels_shipmentId_key" ON "shipping_labels"("shipmentId");

-- CreateIndex
CREATE INDEX "shipping_labels_businessId_idx" ON "shipping_labels"("businessId");

-- CreateIndex
CREATE INDEX "shipping_labels_trackingNumber_idx" ON "shipping_labels"("trackingNumber");

-- CreateIndex
CREATE INDEX "reconciliation_runs_businessId_type_createdAt_idx" ON "reconciliation_runs"("businessId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "reconciliation_entries_runId_status_idx" ON "reconciliation_entries"("runId", "status");

-- CreateIndex
CREATE INDEX "reconciliation_entries_businessId_status_idx" ON "reconciliation_entries"("businessId", "status");

-- CreateIndex
CREATE INDEX "payments_paymentIntentId_idx" ON "payments"("paymentIntentId");

-- CreateIndex
CREATE INDEX "payments_provider_providerPaymentId_idx" ON "payments"("provider", "providerPaymentId");

-- CreateIndex
CREATE INDEX "shipments_trackingNumber_idx" ON "shipments"("trackingNumber");

-- CreateIndex
CREATE INDEX "shipments_provider_providerShipmentId_idx" ON "shipments"("provider", "providerShipmentId");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_socialTransactionId_fkey" FOREIGN KEY ("socialTransactionId") REFERENCES "social_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_socialTransactionId_fkey" FOREIGN KEY ("socialTransactionId") REFERENCES "social_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "transaction_disputes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_socialTransactionId_fkey" FOREIGN KEY ("socialTransactionId") REFERENCES "social_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "transaction_disputes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "return_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_socialTransactionId_fkey" FOREIGN KEY ("socialTransactionId") REFERENCES "social_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_paymentIntentId_fkey" FOREIGN KEY ("paymentIntentId") REFERENCES "payment_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_provider_configs" ADD CONSTRAINT "payment_provider_configs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_webhook_events" ADD CONSTRAINT "provider_webhook_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipping_labels" ADD CONSTRAINT "shipping_labels_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_entries" ADD CONSTRAINT "reconciliation_entries_runId_fkey" FOREIGN KEY ("runId") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_entries" ADD CONSTRAINT "reconciliation_entries_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

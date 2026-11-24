-- CreateEnum
CREATE TYPE "BuyerIdentityStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'MERGED', 'DELETED');

-- CreateEnum
CREATE TYPE "BuyerIdentityProvider" AS ENUM ('ORDERFLOW_ACCOUNT', 'INSTAGRAM', 'WHATSAPP', 'FACEBOOK', 'X', 'EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "IdentityConfidence" AS ENUM ('UNVERIFIED', 'VERIFIED', 'STRONGLY_VERIFIED');

-- CreateEnum
CREATE TYPE "BuyerVerificationPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PHONE_VERIFICATION', 'SOCIAL_LINK_VERIFICATION', 'IDENTITY_MERGE');

-- CreateEnum
CREATE TYPE "BuyerIdentityEventType" AS ENUM ('IDENTITY_CREATED', 'IDENTITY_LINKED', 'IDENTITY_VERIFICATION_REQUESTED', 'IDENTITY_VERIFIED', 'IDENTITY_VERIFICATION_FAILED', 'IDENTITY_UNLINKED', 'IDENTITY_PROFILE_UPDATED', 'MERGE_REQUESTED', 'IDENTITY_MERGED', 'MERGE_REJECTED', 'ACCOUNT_CLAIMED', 'CLAIM_CHALLENGE_ISSUED', 'CLAIM_REJECTED', 'IDENTITY_LOOKUP_FAILED');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "buyerIdentityId" TEXT;

-- AlterTable
ALTER TABLE "social_transactions" ADD COLUMN     "buyerIdentityId" TEXT;

-- CreateTable
CREATE TABLE "buyer_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "status" "BuyerIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
    "accountState" TEXT NOT NULL DEFAULT 'ACTIVE',
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "locale" TEXT,
    "timezone" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "phoneVerifiedAt" TIMESTAMP(3),
    "verificationLevel" "IdentityConfidence" NOT NULL DEFAULT 'UNVERIFIED',
    "privacySettings" JSONB,
    "notificationPreferences" JSONB,
    "lastSeenAt" TIMESTAMP(3),
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_identity_links" (
    "id" TEXT NOT NULL,
    "buyerIdentityId" TEXT NOT NULL,
    "provider" "BuyerIdentityProvider" NOT NULL,
    "externalIdentityId" TEXT NOT NULL,
    "normalizedIdentifier" TEXT,
    "confidence" "IdentityConfidence" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationMethod" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_identity_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_verification_challenges" (
    "id" TEXT NOT NULL,
    "buyerIdentityId" TEXT NOT NULL,
    "purpose" "BuyerVerificationPurpose" NOT NULL,
    "provider" "BuyerIdentityProvider",
    "target" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_claim_challenges" (
    "id" TEXT NOT NULL,
    "buyerIdentityId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_claim_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_identity_merge_requests" (
    "id" TEXT NOT NULL,
    "sourceIdentityId" TEXT NOT NULL,
    "targetIdentityId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "proofChannel" "BuyerIdentityProvider",
    "proofTarget" TEXT,
    "codeHash" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_identity_merge_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_identity_audit_events" (
    "id" TEXT NOT NULL,
    "buyerIdentityId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL DEFAULT 'SYSTEM',
    "actorUserId" TEXT,
    "eventType" "BuyerIdentityEventType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_identity_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyer_identities_userId_key" ON "buyer_identities"("userId");

-- CreateIndex
CREATE INDEX "buyer_identities_status_idx" ON "buyer_identities"("status");

-- CreateIndex
CREATE INDEX "buyer_identities_mergedIntoId_idx" ON "buyer_identities"("mergedIntoId");

-- CreateIndex
CREATE INDEX "buyer_identities_email_idx" ON "buyer_identities"("email");

-- CreateIndex
CREATE INDEX "buyer_identities_phone_idx" ON "buyer_identities"("phone");

-- CreateIndex
CREATE INDEX "buyer_identities_lastSeenAt_idx" ON "buyer_identities"("lastSeenAt");

-- CreateIndex
CREATE INDEX "buyer_identity_links_buyerIdentityId_idx" ON "buyer_identity_links"("buyerIdentityId");

-- CreateIndex
CREATE INDEX "buyer_identity_links_provider_normalizedIdentifier_idx" ON "buyer_identity_links"("provider", "normalizedIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_identity_links_provider_externalIdentityId_key" ON "buyer_identity_links"("provider", "externalIdentityId");

-- CreateIndex
CREATE INDEX "buyer_verification_challenges_buyerIdentityId_purpose_idx" ON "buyer_verification_challenges"("buyerIdentityId", "purpose");

-- CreateIndex
CREATE INDEX "buyer_verification_challenges_buyerIdentityId_createdAt_idx" ON "buyer_verification_challenges"("buyerIdentityId", "createdAt");

-- CreateIndex
CREATE INDEX "buyer_verification_challenges_expiresAt_idx" ON "buyer_verification_challenges"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_claim_challenges_tokenHash_key" ON "buyer_claim_challenges"("tokenHash");

-- CreateIndex
CREATE INDEX "buyer_claim_challenges_buyerIdentityId_transactionId_idx" ON "buyer_claim_challenges"("buyerIdentityId", "transactionId");

-- CreateIndex
CREATE INDEX "buyer_claim_challenges_expiresAt_idx" ON "buyer_claim_challenges"("expiresAt");

-- CreateIndex
CREATE INDEX "buyer_identity_merge_requests_sourceIdentityId_status_idx" ON "buyer_identity_merge_requests"("sourceIdentityId", "status");

-- CreateIndex
CREATE INDEX "buyer_identity_merge_requests_targetIdentityId_status_idx" ON "buyer_identity_merge_requests"("targetIdentityId", "status");

-- CreateIndex
CREATE INDEX "buyer_identity_audit_events_buyerIdentityId_createdAt_idx" ON "buyer_identity_audit_events"("buyerIdentityId", "createdAt");

-- CreateIndex
CREATE INDEX "buyer_identity_audit_events_eventType_idx" ON "buyer_identity_audit_events"("eventType");

-- CreateIndex
CREATE INDEX "customers_buyerIdentityId_idx" ON "customers"("buyerIdentityId");

-- CreateIndex
CREATE INDEX "customers_businessId_email_idx" ON "customers"("businessId", "email");

-- CreateIndex
CREATE INDEX "customers_businessId_phone_idx" ON "customers"("businessId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "customers_businessId_buyerIdentityId_key" ON "customers"("businessId", "buyerIdentityId");

-- CreateIndex
CREATE INDEX "social_transactions_buyerIdentityId_idx" ON "social_transactions"("buyerIdentityId");

-- CreateIndex
CREATE INDEX "social_transactions_buyerIdentityId_createdAt_idx" ON "social_transactions"("buyerIdentityId", "createdAt");

-- AddForeignKey
ALTER TABLE "buyer_identities" ADD CONSTRAINT "buyer_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_identities" ADD CONSTRAINT "buyer_identities_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "buyer_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_identity_links" ADD CONSTRAINT "buyer_identity_links_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_verification_challenges" ADD CONSTRAINT "buyer_verification_challenges_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_claim_challenges" ADD CONSTRAINT "buyer_claim_challenges_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_claim_challenges" ADD CONSTRAINT "buyer_claim_challenges_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "social_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_identity_merge_requests" ADD CONSTRAINT "buyer_identity_merge_requests_sourceIdentityId_fkey" FOREIGN KEY ("sourceIdentityId") REFERENCES "buyer_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_identity_merge_requests" ADD CONSTRAINT "buyer_identity_merge_requests_targetIdentityId_fkey" FOREIGN KEY ("targetIdentityId") REFERENCES "buyer_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_identity_audit_events" ADD CONSTRAINT "buyer_identity_audit_events_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_transactions" ADD CONSTRAINT "social_transactions_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;


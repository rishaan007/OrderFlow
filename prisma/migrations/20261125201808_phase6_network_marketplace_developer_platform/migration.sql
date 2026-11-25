-- CreateEnum
CREATE TYPE "PrivacyVisibility" AS ENUM ('PRIVATE', 'SELLER_VISIBLE', 'NETWORK_VISIBLE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ReviewDisplayMode" AS ENUM ('VERIFIED_BUYER', 'NAME_INITIAL', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "MarketplaceOptInStatus" AS ENUM ('NOT_DISCOVERABLE', 'DISCOVERABLE');

-- CreateEnum
CREATE TYPE "SellerVerificationTier" AS ENUM ('UNVERIFIED', 'IDENTITY_VERIFIED', 'BUSINESS_VERIFIED', 'HIGH_CONFIDENCE');

-- CreateEnum
CREATE TYPE "VerificationRequestStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccountLifecycleStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'DELETED');

-- CreateEnum
CREATE TYPE "ReviewModerationState" AS ENUM ('PUBLISHED', 'UNDER_REVIEW', 'HIDDEN', 'REMOVED');

-- CreateEnum
CREATE TYPE "ApiKeyType" AS ENUM ('PUBLIC', 'PRIVATE', 'SERVER');

-- CreateEnum
CREATE TYPE "ApiEnvironment" AS ENUM ('SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'ROTATED', 'REVOKED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'DELIVERING', 'DELIVERED', 'RETRYING', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "IntegrationCategory" AS ENUM ('PAYMENTS', 'LOGISTICS', 'CRM', 'ACCOUNTING', 'ANALYTICS', 'MARKETING', 'COMMUNICATION', 'COMMERCE');

-- CreateEnum
CREATE TYPE "AbuseActionType" AS ENUM ('FLAG', 'REVIEW', 'LIMIT', 'SUSPEND', 'APPEAL', 'RESOLVE');

-- CreateEnum
CREATE TYPE "AbuseTargetType" AS ENUM ('SELLER', 'BUYER', 'REVIEW', 'LISTING', 'API_APP', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "TaxCalculationMode" AS ENUM ('EXCLUSIVE', 'INCLUSIVE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AutomationJobType" ADD VALUE 'WEBHOOK_RETRY';
ALTER TYPE "AutomationJobType" ADD VALUE 'NOTIFICATION_DELIVERY';
ALTER TYPE "AutomationJobType" ADD VALUE 'RECONCILIATION';
ALTER TYPE "AutomationJobType" ADD VALUE 'ANALYTICS_AGGREGATION';
ALTER TYPE "AutomationJobType" ADD VALUE 'SEARCH_INDEXING';
ALTER TYPE "AutomationJobType" ADD VALUE 'DATA_EXPORT';
ALTER TYPE "AutomationJobType" ADD VALUE 'INTEGRATION_SYNC';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BuyerIdentityEventType" ADD VALUE 'IDENTITY_DEACTIVATED';
ALTER TYPE "BuyerIdentityEventType" ADD VALUE 'IDENTITY_EXPORTED';
ALTER TYPE "BuyerIdentityEventType" ADD VALUE 'PRIVACY_UPDATED';

-- AlterEnum
ALTER TYPE "BuyerIdentityStatus" ADD VALUE 'DEACTIVATED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderSource" ADD VALUE 'MARKETPLACE';
ALTER TYPE "OrderSource" ADD VALUE 'API';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SocialPlatform" ADD VALUE 'MARKETPLACE';
ALTER TYPE "SocialPlatform" ADD VALUE 'API';

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "accountStatus" "AccountLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "countryCode" TEXT NOT NULL DEFAULT 'US',
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isSandboxBusiness" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "buyer_identities" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "networkVisibility" "PrivacyVisibility" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "reviewDisplayMode" "ReviewDisplayMode" NOT NULL DEFAULT 'VERIFIED_BUYER';

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "feesMinorUnits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shippingAddressStructured" JSONB,
ADD COLUMN     "taxBreakdown" JSONB,
ADD COLUMN     "totalSnapshot" JSONB;

-- AlterTable
ALTER TABLE "payment_intents" ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "brand" TEXT,
ADD COLUMN     "marketplaceDiscoverable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "shipments" ADD COLUMN     "countryCode" TEXT,
ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "social_transactions" ADD COLUMN     "isSandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "locale" TEXT DEFAULT 'en',
ADD COLUMN     "timezone" TEXT DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "seller_profiles" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "tagline" TEXT,
    "about" TEXT,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "city" TEXT,
    "state" TEXT,
    "countryCode" TEXT,
    "logoUrl" TEXT,
    "coverImageUrl" TEXT,
    "websiteUrl" TEXT,
    "marketplaceOptIn" "MarketplaceOptInStatus" NOT NULL DEFAULT 'NOT_DISCOVERABLE',
    "verificationTier" "SellerVerificationTier" NOT NULL DEFAULT 'UNVERIFIED',
    "returnPolicySummary" TEXT,
    "socialLinks" JSONB,
    "supportedCurrencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supportedLocales" TEXT[] DEFAULT ARRAY['en']::TEXT[],
    "accountStatus" "AccountLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_verifications" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "requestedTier" "SellerVerificationTier" NOT NULL,
    "status" "VerificationRequestStatus" NOT NULL DEFAULT 'PENDING',
    "verificationMethod" TEXT NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "evidenceReference" TEXT,
    "reviewerNotes" TEXT,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "brand" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sku" TEXT,
    "priceMinorUnits" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "inStock" BOOLEAN NOT NULL DEFAULT true,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "discoverable" BOOLEAN NOT NULL DEFAULT false,
    "sellerVerifiedTier" "SellerVerificationTier" NOT NULL DEFAULT 'UNVERIFIED',
    "sellerFulfillmentRate" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "sellerCity" TEXT,
    "sellerCountryCode" TEXT,
    "reviewAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "searchText" TEXT NOT NULL,
    "viewsCount" INTEGER NOT NULL DEFAULT 0,
    "ordersCount" INTEGER NOT NULL DEFAULT 0,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_reputations" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "observedFacts" JSONB NOT NULL,
    "derivedBadges" JSONB NOT NULL,
    "reviewStats" JSONB,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "observationWindow" TEXT NOT NULL DEFAULT '180d',
    "verificationLevel" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "explanation" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL DEFAULT 'v2',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_reputations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "socialTransactionId" TEXT NOT NULL,
    "buyerIdentityId" TEXT NOT NULL,
    "productId" TEXT,
    "reviewScopeKey" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "comment" TEXT,
    "authorDisplayMode" "ReviewDisplayMode" NOT NULL DEFAULT 'VERIFIED_BUYER',
    "authorDisplayName" TEXT NOT NULL,
    "moderationState" "ReviewModerationState" NOT NULL DEFAULT 'PUBLISHED',
    "moderationNotes" TEXT,
    "sellerResponse" TEXT,
    "sellerRespondedAt" TIMESTAMP(3),
    "sellerResponderId" TEXT,
    "editableUntil" TIMESTAMP(3) NOT NULL,
    "editCount" INTEGER NOT NULL DEFAULT 0,
    "editHistory" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "reporterType" TEXT NOT NULL,
    "reporterId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationName" TEXT,
    "websiteUrl" TEXT,
    "contactEmail" TEXT,
    "status" "AccountLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "developers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_applications" (
    "id" TEXT NOT NULL,
    "developerId" TEXT NOT NULL,
    "businessId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "environment" "ApiEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "status" "AccountLifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateLimitPerMin" INTEGER NOT NULL DEFAULT 120,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "developer_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "businessId" TEXT,
    "name" TEXT NOT NULL,
    "keyType" "ApiKeyType" NOT NULL DEFAULT 'SERVER',
    "environment" "ApiEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_subscriptions" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "description" TEXT,
    "eventTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" "ApiEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "encryptedSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "attemptHistory" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "businessId" TEXT,
    "method" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "environment" "ApiEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_providers" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "IntegrationCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "authType" TEXT NOT NULL DEFAULT 'API_KEY',
    "logoUrl" TEXT,
    "docsUrl" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_connections" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "environment" "ApiEnvironment" NOT NULL DEFAULT 'SANDBOX',
    "externalAccountId" TEXT,
    "encryptedCredentials" TEXT,
    "config" JSONB,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'INBOUND',
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rules" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "stateCode" TEXT,
    "category" TEXT,
    "rateBasisPoints" INTEGER NOT NULL,
    "mode" "TaxCalculationMode" NOT NULL DEFAULT 'EXCLUSIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_components" (
    "id" TEXT NOT NULL,
    "taxRuleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rateBasisPoints" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_exports" (
    "id" TEXT NOT NULL,
    "requesterType" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "buyerIdentityId" TEXT,
    "businessId" TEXT,
    "exportType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'JSON',
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "payload" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "jobType" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_abuse_cases" (
    "id" TEXT NOT NULL,
    "targetType" "AbuseTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "businessId" TEXT,
    "buyerIdentityId" TEXT,
    "reason" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "actionTaken" "AbuseActionType",
    "evidence" JSONB,
    "auditTrail" JSONB,
    "appealNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_abuse_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_rate_limits" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "network_rate_limits_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_profiles_businessId_key" ON "seller_profiles"("businessId");

-- CreateIndex
CREATE INDEX "seller_profiles_marketplaceOptIn_accountStatus_idx" ON "seller_profiles"("marketplaceOptIn", "accountStatus");

-- CreateIndex
CREATE INDEX "seller_profiles_verificationTier_idx" ON "seller_profiles"("verificationTier");

-- CreateIndex
CREATE INDEX "seller_profiles_countryCode_city_idx" ON "seller_profiles"("countryCode", "city");

-- CreateIndex
CREATE INDEX "seller_verifications_businessId_status_idx" ON "seller_verifications"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_listings_productId_key" ON "marketplace_listings"("productId");

-- CreateIndex
CREATE INDEX "marketplace_listings_discoverable_category_inStock_idx" ON "marketplace_listings"("discoverable", "category", "inStock");

-- CreateIndex
CREATE INDEX "marketplace_listings_discoverable_priceMinorUnits_idx" ON "marketplace_listings"("discoverable", "priceMinorUnits");

-- CreateIndex
CREATE INDEX "marketplace_listings_discoverable_sellerVerifiedTier_idx" ON "marketplace_listings"("discoverable", "sellerVerifiedTier");

-- CreateIndex
CREATE INDEX "marketplace_listings_businessId_discoverable_idx" ON "marketplace_listings"("businessId", "discoverable");

-- CreateIndex
CREATE INDEX "marketplace_listings_brand_idx" ON "marketplace_listings"("brand");

-- CreateIndex
CREATE INDEX "marketplace_listings_sellerCountryCode_sellerCity_idx" ON "marketplace_listings"("sellerCountryCode", "sellerCity");

-- CreateIndex
CREATE INDEX "network_reputations_entityType_computedAt_idx" ON "network_reputations"("entityType", "computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "network_reputations_entityType_entityId_key" ON "network_reputations"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "reviews_businessId_moderationState_createdAt_idx" ON "reviews"("businessId", "moderationState", "createdAt");

-- CreateIndex
CREATE INDEX "reviews_productId_moderationState_idx" ON "reviews"("productId", "moderationState");

-- CreateIndex
CREATE INDEX "reviews_orderId_idx" ON "reviews"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_buyerIdentityId_reviewScopeKey_key" ON "reviews"("buyerIdentityId", "reviewScopeKey");

-- CreateIndex
CREATE INDEX "review_reports_reviewId_status_idx" ON "review_reports"("reviewId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "developers_userId_key" ON "developers"("userId");

-- CreateIndex
CREATE INDEX "developer_applications_developerId_idx" ON "developer_applications"("developerId");

-- CreateIndex
CREATE INDEX "developer_applications_businessId_idx" ON "developer_applications"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "api_keys_applicationId_status_idx" ON "api_keys"("applicationId", "status");

-- CreateIndex
CREATE INDEX "api_keys_businessId_idx" ON "api_keys"("businessId");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_businessId_environment_status_idx" ON "webhook_subscriptions"("businessId", "environment", "status");

-- CreateIndex
CREATE INDEX "webhook_subscriptions_applicationId_idx" ON "webhook_subscriptions"("applicationId");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_nextRetryAt_idx" ON "webhook_deliveries"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_businessId_createdAt_idx" ON "webhook_deliveries"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_subscriptionId_eventId_key" ON "webhook_deliveries"("subscriptionId", "eventId");

-- CreateIndex
CREATE INDEX "api_usage_applicationId_createdAt_idx" ON "api_usage"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "api_usage_businessId_createdAt_idx" ON "api_usage"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_providers_slug_key" ON "integration_providers"("slug");

-- CreateIndex
CREATE INDEX "integration_providers_category_isActive_idx" ON "integration_providers"("category", "isActive");

-- CreateIndex
CREATE INDEX "integration_connections_businessId_status_idx" ON "integration_connections"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_businessId_providerId_environment_key" ON "integration_connections"("businessId", "providerId", "environment");

-- CreateIndex
CREATE INDEX "integration_events_connectionId_createdAt_idx" ON "integration_events"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "integration_events_businessId_createdAt_idx" ON "integration_events"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "tax_rules_businessId_countryCode_isActive_idx" ON "tax_rules"("businessId", "countryCode", "isActive");

-- CreateIndex
CREATE INDEX "tax_rules_countryCode_stateCode_category_idx" ON "tax_rules"("countryCode", "stateCode", "category");

-- CreateIndex
CREATE INDEX "tax_components_taxRuleId_idx" ON "tax_components"("taxRuleId");

-- CreateIndex
CREATE INDEX "data_exports_buyerIdentityId_createdAt_idx" ON "data_exports"("buyerIdentityId", "createdAt");

-- CreateIndex
CREATE INDEX "data_exports_businessId_createdAt_idx" ON "data_exports"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_idempotencyKey_key" ON "background_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "background_jobs_status_nextRunAt_idx" ON "background_jobs"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "background_jobs_businessId_jobType_idx" ON "background_jobs"("businessId", "jobType");

-- CreateIndex
CREATE INDEX "platform_abuse_cases_targetType_targetId_idx" ON "platform_abuse_cases"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "platform_abuse_cases_status_createdAt_idx" ON "platform_abuse_cases"("status", "createdAt");

-- CreateIndex
CREATE INDEX "network_rate_limits_resetAt_idx" ON "network_rate_limits"("resetAt");

-- CreateIndex
CREATE INDEX "businesses_accountStatus_idx" ON "businesses"("accountStatus");

-- CreateIndex
CREATE INDEX "businesses_countryCode_idx" ON "businesses"("countryCode");

-- CreateIndex
CREATE INDEX "buyer_identities_networkVisibility_idx" ON "buyer_identities"("networkVisibility");

-- CreateIndex
CREATE INDEX "orders_businessId_isSandbox_idx" ON "orders"("businessId", "isSandbox");

-- CreateIndex
CREATE INDEX "products_marketplaceDiscoverable_status_idx" ON "products"("marketplaceDiscoverable", "status");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "products_brand_idx" ON "products"("brand");

-- AddForeignKey
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_verifications" ADD CONSTRAINT "seller_verifications_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_socialTransactionId_fkey" FOREIGN KEY ("socialTransactionId") REFERENCES "social_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developers" ADD CONSTRAINT "developers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_applications" ADD CONSTRAINT "developer_applications_developerId_fkey" FOREIGN KEY ("developerId") REFERENCES "developers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "developer_applications" ADD CONSTRAINT "developer_applications_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "developer_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_subscriptions" ADD CONSTRAINT "webhook_subscriptions_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "developer_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "webhook_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "developer_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage" ADD CONSTRAINT "api_usage_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "integration_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_events" ADD CONSTRAINT "integration_events_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rules" ADD CONSTRAINT "tax_rules_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_components" ADD CONSTRAINT "tax_components_taxRuleId_fkey" FOREIGN KEY ("taxRuleId") REFERENCES "tax_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_buyerIdentityId_fkey" FOREIGN KEY ("buyerIdentityId") REFERENCES "buyer_identities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

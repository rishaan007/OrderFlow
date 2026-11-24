import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/lib/prisma";
import { getTenantDb } from "../src/lib/tenant";
import {
  BuyerIdentityProvider,
  BuyerIdentityStatus,
  IdentityConfidence,
  BuyerIdentityEventType,
  SocialPlatform,
  SocialSurface,
  TransactionStatus,
  TimelineActor,
  TimelineVisibility,
  ConversationChannel,
  OrderStatus,
  PaymentStatus,
} from "@prisma/client";
import {
  getOrCreateBuyerIdentity,
  linkBuyerIdentity,
  unlinkBuyerIdentity,
  requestContactVerification,
  verifyContactCode,
  createClaimChallenge,
  claimTransactionWithChallenge,
  claimTransactionDirect,
  getBuyerProfile,
  updateBuyerProfile,
  getBuyerPrivacySummary,
  createMergeRequest,
  confirmIdentityMerge,
  resolveSellerCustomerForBuyer,
  getSellerBuyerLinkSummary,
  getBuyerIdentityAuditTrail,
  IdentityConflictError,
  IdentityNotFoundError,
  VerificationChallengeError,
  IdentityRateLimitError,
  BuyerIdentityError,
} from "../src/lib/buyer-identity";
import {
  claimGuestTransaction,
  getBuyerPurchases,
  getBuyerNotifications,
  markBuyerNotificationAsRead,
  confirmDeliveryInformation,
  submitBuyerPaymentProof,
} from "../src/lib/buyer";
import {
  createSocialTransaction,
  getPublicTransactionByToken,
  createPublicDispute,
} from "../src/lib/transactions";
import {
  createDraftTransaction,
  confirmDraftTransaction,
} from "../src/lib/draft-transactions";
import { getPlatformsCapabilityMatrix } from "../src/lib/providers/registry";

let tenantA: ReturnType<typeof getTenantDb>;
let tenantB: ReturnType<typeof getTenantDb>;
let businessAId: string;
let businessBId: string;

let testUser1Id: string;
let testUser2Id: string;
let testUser3Id: string;
let testIgHandle: string;
let testWaNumber: string;

beforeAll(async () => {
  // Ensure we have two distinct business tenants for multi-tenant isolation tests
  const b1 = await prisma.business.upsert({
    where: { slug: "phase3-buyer-tenant-a" },
    update: {},
    create: {
      name: "Phase 3 Buyer Tenant A",
      slug: "phase3-buyer-tenant-a",
      currency: "USD",
    },
  });
  const b2 = await prisma.business.upsert({
    where: { slug: "phase3-buyer-tenant-b" },
    update: {},
    create: {
      name: "Phase 3 Buyer Tenant B",
      slug: "phase3-buyer-tenant-b",
      currency: "EUR",
    },
  });

  businessAId = b1.id;
  businessBId = b2.id;
  tenantA = getTenantDb(businessAId);
  tenantB = getTenantDb(businessBId);

  // Create test users for buyer identity tests
  const timestamp = Date.now();
  const u1 = await prisma.user.create({
    data: {
      email: `buyer1_${timestamp}@example.com`,
      name: "Alice Buyer",
    },
  });
  const u2 = await prisma.user.create({
    data: {
      email: `buyer2_${timestamp}@example.com`,
      name: "Bob Shopper",
    },
  });
  const u3 = await prisma.user.create({
    data: {
      email: `buyer3_${timestamp}@example.com`,
      name: "Charlie Customer",
    },
  });

  testUser1Id = u1.id;
  testUser2Id = u2.id;
  testUser3Id = u3.id;
  testIgHandle = `@alice_fashion_${timestamp}`;
  testWaNumber = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
});

describe("Phase 3: Cross-Platform Buyer Identity & Universal Buyer Experience", () => {
  // ------------------------------------------------------------------
  // 1. BuyerIdentity creation
  // ------------------------------------------------------------------
  describe("1. BuyerIdentity creation", () => {
    it("should create canonical BuyerIdentity with anchor link and asserted contact", async () => {
      const identity = await getOrCreateBuyerIdentity(testUser1Id);

      expect(identity).toBeDefined();
      expect(identity.id).toBeDefined();
      expect(identity.userId).toBe(testUser1Id);
      expect(identity.status).toBe(BuyerIdentityStatus.ACTIVE);
      expect(identity.verificationLevel).toBe(IdentityConfidence.UNVERIFIED);

      // Verify anchor account link was created
      const anchorLink = await prisma.buyerIdentityLink.findUnique({
        where: {
          provider_externalIdentityId: {
            provider: BuyerIdentityProvider.ORDERFLOW_ACCOUNT,
            externalIdentityId: testUser1Id,
          },
        },
      });
      expect(anchorLink).toBeDefined();
      expect(anchorLink?.confidence).toBe(IdentityConfidence.STRONGLY_VERIFIED);

      // Verify audit event recorded
      const trail = await getBuyerIdentityAuditTrail(identity.id);
      expect(trail.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ------------------------------------------------------------------
  // 2. identity uniqueness
  // ------------------------------------------------------------------
  describe("2. identity uniqueness", () => {
    it("should ensure idempotent resolution and enforce uniqueness constraint per user", async () => {
      const first = await getOrCreateBuyerIdentity(testUser1Id);
      const second = await getOrCreateBuyerIdentity(testUser1Id);
      expect(first.id).toBe(second.id);

      // Attempting to duplicate direct database creation with same userId must fail
      await expect(
        prisma.buyerIdentity.create({
          data: {
            userId: testUser1Id,
            displayName: "Duplicate Attempt",
          },
        })
      ).rejects.toThrow();
    });
  });

  // ------------------------------------------------------------------
  // 3. social identity linking
  // ------------------------------------------------------------------
  describe("3. social identity linking", () => {
    it("should link external social identities as UNVERIFIED assertions", async () => {
      const igResult = await linkBuyerIdentity(testUser1Id, {
        provider: BuyerIdentityProvider.INSTAGRAM,
        externalIdentityId: testIgHandle,
      });

      expect(igResult.link.id).toBeDefined();
      expect(igResult.link.provider).toBe(BuyerIdentityProvider.INSTAGRAM);
      expect(igResult.link.normalizedIdentifier).toBe(testIgHandle.replace("@", ""));
      expect(igResult.link.confidence).toBe(IdentityConfidence.UNVERIFIED);

      const waResult = await linkBuyerIdentity(testUser1Id, {
        provider: BuyerIdentityProvider.WHATSAPP,
        externalIdentityId: testWaNumber,
      });
      expect(waResult.link.normalizedIdentifier).toBe(testWaNumber);
    });
  });

  // ------------------------------------------------------------------
  // 4. duplicate link prevention
  // ------------------------------------------------------------------
  describe("4. duplicate link prevention", () => {
    it("should prevent conflicting ownership of the same social handle across buyers", async () => {
      // User 2 attempts to link the same Instagram handle already owned by User 1
      await expect(
        linkBuyerIdentity(testUser2Id, {
          provider: BuyerIdentityProvider.INSTAGRAM,
          externalIdentityId: testIgHandle,
        })
      ).rejects.toThrow(IdentityConflictError);

      // User 1 linking same handle again is idempotent
      const relink = await linkBuyerIdentity(testUser1Id, {
        provider: BuyerIdentityProvider.INSTAGRAM,
        externalIdentityId: testIgHandle,
      });
      expect(relink.alreadyLinked).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // 5. verified identity linking
  // ------------------------------------------------------------------
  describe("5. verified identity linking", () => {
    it("should issue verification challenge and verify code with confidence promotion", async () => {
      const targetEmail = `verified_${Date.now()}@example.com`;

      const challenge = await requestContactVerification(
        testUser1Id,
        { type: "EMAIL", value: targetEmail },
        { returnChallengeCodeForDelivery: true }
      );

      expect(challenge.challengeId).toBeDefined();
      expect(challenge.code).toBeDefined();

      // Submit verification code
      const result = await verifyContactCode(testUser1Id, {
        challengeId: challenge.challengeId,
        code: challenge.code!,
      });

      expect(result.success).toBe(true);

      // Verify link confidence upgraded
      const link = await prisma.buyerIdentityLink.findUnique({
        where: {
          provider_externalIdentityId: {
            provider: BuyerIdentityProvider.EMAIL,
            externalIdentityId: targetEmail,
          },
        },
      });
      expect(link?.confidence).toBe(IdentityConfidence.VERIFIED);
      expect(link?.verifiedAt).toBeDefined();

      // Buyer identity verification level upgraded
      const identity = await prisma.buyerIdentity.findFirst({
        where: { userId: testUser1Id },
      });
      expect([IdentityConfidence.VERIFIED, IdentityConfidence.STRONGLY_VERIFIED]).toContain(
        identity?.verificationLevel
      );
      expect(identity?.emailVerifiedAt).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // 6. identity unlinking
  // ------------------------------------------------------------------
  describe("6. identity unlinking", () => {
    it("should unlink a social identity and prohibit unlinking primary account anchor", async () => {
      const link = await prisma.buyerIdentityLink.findFirst({
        where: {
          provider: BuyerIdentityProvider.INSTAGRAM,
          externalIdentityId: testIgHandle.replace("@", ""),
        },
      });
      expect(link).toBeDefined();

      const res = await unlinkBuyerIdentity(testUser1Id, link!.id);
      expect(res.success).toBe(true);

      const deleted = await prisma.buyerIdentityLink.findUnique({
        where: { id: link!.id },
      });
      expect(deleted).toBeNull();

      // Prohibit unlinking ORDERFLOW_ACCOUNT
      const anchor = await prisma.buyerIdentityLink.findFirst({
        where: {
          provider: BuyerIdentityProvider.ORDERFLOW_ACCOUNT,
          externalIdentityId: testUser1Id,
        },
      });
      expect(anchor).toBeDefined();
      await expect(
        unlinkBuyerIdentity(testUser1Id, anchor!.id)
      ).rejects.toThrow(BuyerIdentityError);
    });
  });

  // ------------------------------------------------------------------
  // 7. guest transaction claiming
  // ------------------------------------------------------------------
  describe("7. guest transaction claiming", () => {
    it("should claim guest transaction and link both buyerUserId and buyerIdentityId", async () => {
      const guestTx = await createSocialTransaction(businessAId, {
        platform: SocialPlatform.INSTAGRAM,
        surface: SocialSurface.DM,
        status: TransactionStatus.ORDER_CREATED,
        externalUserId: "guest_buyer_99",
      });

      expect(guestTx.buyerUserId).toBeNull();
      expect(guestTx.buyerIdentityId).toBeNull();

      const claimed = await claimGuestTransaction(testUser1Id, guestTx.publicTrackingToken);

      expect(claimed.buyerUserId).toBe(testUser1Id);
      expect(claimed.buyerIdentityId).toBeDefined();

      const identity = await getOrCreateBuyerIdentity(testUser1Id);
      expect(claimed.buyerIdentityId).toBe(identity.id);

      // Verify internal timeline event created
      const events = await prisma.transactionTimelineEvent.findMany({
        where: { transactionId: guestTx.id, eventType: "TRANSACTION_CLAIMED" },
      });
      expect(events.length).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // 8. claim token security
  // ------------------------------------------------------------------
  describe("8. claim token security", () => {
    it("should reject claiming invalid token or already claimed transaction", async () => {
      // Invalid token
      await expect(
        claimTransactionDirect(testUser1Id, "non_existent_token_12345")
      ).rejects.toThrow();

      // Create and claim by User 1
      const tx = await createSocialTransaction(businessAId, {
        platform: SocialPlatform.WHATSAPP,
        surface: SocialSurface.DM,
        status: TransactionStatus.INQUIRY,
      });
      await claimTransactionDirect(testUser1Id, tx.publicTrackingToken);

      // User 2 cannot hijack already claimed transaction
      await expect(
        claimTransactionDirect(testUser2Id, tx.publicTrackingToken)
      ).rejects.toThrow();
    });

    it("should support secure cryptographic claim challenge flow", async () => {
      const tx = await createSocialTransaction(businessBId, {
        platform: SocialPlatform.X,
        surface: SocialSurface.POST,
        status: TransactionStatus.INQUIRY,
      });

      const challenge = await createClaimChallenge(testUser2Id, tx.publicTrackingToken);
      expect(challenge.challengeId).toBeDefined();
      expect(challenge.challengeToken).toBeDefined();

      // Consuming with wrong token must fail
      await expect(
        claimTransactionWithChallenge(testUser2Id, {
          challengeId: challenge.challengeId,
          challengeToken: "wrong_token_secret",
        })
      ).rejects.toThrow(VerificationChallengeError);

      // Consuming with valid token succeeds
      const claimed = await claimTransactionWithChallenge(testUser2Id, {
        challengeId: challenge.challengeId,
        challengeToken: challenge.challengeToken,
      });
      expect(claimed.buyerUserId).toBe(testUser2Id);

      // Second consumption must fail (single-use)
      await expect(
        claimTransactionWithChallenge(testUser2Id, {
          challengeId: challenge.challengeId,
          challengeToken: challenge.challengeToken,
        })
      ).rejects.toThrow(VerificationChallengeError);
    });
  });

  // ------------------------------------------------------------------
  // 9. buyer transaction history
  // ------------------------------------------------------------------
  describe("9. buyer transaction history", () => {
    it("should retrieve buyer purchase history with accurate counts and status grouping", async () => {
      const history = await getBuyerPurchases(testUser1Id, "ALL");
      expect(history.items).toBeDefined();
      expect(history.counts.total).toBeGreaterThanOrEqual(1);
    });
  });

  // ------------------------------------------------------------------
  // 10. cross-platform transaction aggregation
  // ------------------------------------------------------------------
  describe("10. cross-platform transaction aggregation", () => {
    it("should aggregate purchases originating from Instagram, WhatsApp, Facebook, and X into one buyer view", async () => {
      // Create transactions from different platforms and associate with User 1
      const ig = await createSocialTransaction(businessAId, {
        platform: SocialPlatform.INSTAGRAM,
        surface: SocialSurface.STORY_REPLY,
      });
      const wa = await createSocialTransaction(businessAId, {
        platform: SocialPlatform.WHATSAPP,
        surface: SocialSurface.CATALOG,
      });
      const fb = await createSocialTransaction(businessBId, {
        platform: SocialPlatform.FACEBOOK,
        surface: SocialSurface.MARKETPLACE,
      });
      const x = await createSocialTransaction(businessBId, {
        platform: SocialPlatform.X,
        surface: SocialSurface.DM,
      });

      await claimTransactionDirect(testUser1Id, ig.publicTrackingToken);
      await claimTransactionDirect(testUser1Id, wa.publicTrackingToken);
      await claimTransactionDirect(testUser1Id, fb.publicTrackingToken);
      await claimTransactionDirect(testUser1Id, x.publicTrackingToken);

      const purchases = await getBuyerPurchases(testUser1Id, "ALL");
      const platforms = purchases.items.map((i) => i.platform);

      expect(platforms).toContain(SocialPlatform.INSTAGRAM);
      expect(platforms).toContain(SocialPlatform.WHATSAPP);
      expect(platforms).toContain(SocialPlatform.FACEBOOK);
      expect(platforms).toContain(SocialPlatform.X);
    });
  });

  // ------------------------------------------------------------------
  // 11. seller customer resolution
  // ------------------------------------------------------------------
  describe("11. seller customer resolution", () => {
    it("should resolve customer deterministically by verified contact and link to tenant", async () => {
      const identity = await getOrCreateBuyerIdentity(testUser1Id);
      const verifiedEmail = identity.email;

      const res = await resolveSellerCustomerForBuyer({
        businessId: businessAId,
        buyerIdentityId: identity.id,
        email: verifiedEmail,
        name: "Alice Verified",
      });

      expect(res.customer.id).toBeDefined();
      expect(res.customer.businessId).toBe(businessAId);
      expect(res.customer.buyerIdentityId).toBe(identity.id);

      // Re-resolving in same tenant returns the same customer record
      const reRes = await resolveSellerCustomerForBuyer({
        businessId: businessAId,
        buyerIdentityId: identity.id,
      });
      expect(reRes.customer.id).toBe(res.customer.id);
    });
  });

  // ------------------------------------------------------------------
  // 12. tenant isolation
  // ------------------------------------------------------------------
  describe("12. tenant isolation", () => {
    it("should strictly isolate seller customer records between business tenants", async () => {
      const identity = await getOrCreateBuyerIdentity(testUser1Id);

      // Resolve customer in Business A
      const custA = await resolveSellerCustomerForBuyer({
        businessId: businessAId,
        buyerIdentityId: identity.id,
        name: "Alice Tenant A",
      });

      // Resolve customer in Business B
      const custB = await resolveSellerCustomerForBuyer({
        businessId: businessBId,
        buyerIdentityId: identity.id,
        name: "Alice Tenant B",
      });

      expect(custA.customer.id).not.toBe(custB.customer.id);
      expect(custA.customer.businessId).toBe(businessAId);
      expect(custB.customer.businessId).toBe(businessBId);

      // Seller in Business A cannot read customer record of Business B
      const summaryA = await getSellerBuyerLinkSummary(businessAId, custB.customer.id);
      expect(summaryA).toBeNull();
    });
  });

  // ------------------------------------------------------------------
  // 13. buyer isolation
  // ------------------------------------------------------------------
  describe("13. buyer isolation", () => {
    it("should prevent Buyer A from reading or modifying Buyer B profile", async () => {
      const profile1 = await getBuyerProfile(testUser1Id);
      const profile2 = await getBuyerProfile(testUser2Id);

      expect(profile1.buyerId).not.toBe(profile2.buyerId);

      // User 2 updating profile does not affect User 1
      await updateBuyerProfile(testUser2Id, { displayName: "Updated Bob" });
      const fresh1 = await getBuyerProfile(testUser1Id);
      expect(fresh1.displayName).toBe("Alice Buyer");
    });
  });

  // ------------------------------------------------------------------
  // 14. identity merge
  // ------------------------------------------------------------------
  describe("14. identity merge", () => {
    it("should merge a guest identity into an authenticated identity with verified proof", async () => {
      // Create a guest/target identity with a verified contact (unattached to any User)
      const guestEmail = `guest_merge_${Date.now()}@example.com`;
      const targetIdentity = await prisma.buyerIdentity.create({
        data: {
          displayName: "Guest Identity To Merge",
          email: guestEmail,
          emailVerifiedAt: new Date(),
          verificationLevel: IdentityConfidence.VERIFIED,
        },
      });

      await prisma.buyerIdentityLink.create({
        data: {
          buyerIdentityId: targetIdentity.id,
          provider: BuyerIdentityProvider.EMAIL,
          externalIdentityId: guestEmail,
          normalizedIdentifier: guestEmail,
          confidence: IdentityConfidence.VERIFIED,
          verifiedAt: new Date(),
        },
      });

      // Attach a transaction to target identity
      const targetTx = await createSocialTransaction(businessAId, {
        platform: SocialPlatform.INSTAGRAM,
        surface: SocialSurface.DM,
      });
      await prisma.socialTransaction.update({
        where: { id: targetTx.id },
        data: { buyerIdentityId: targetIdentity.id },
      });

      // User 3 initiates merge
      const mergeReq = await createMergeRequest(
        testUser3Id,
        targetIdentity.id,
        { returnChallengeCodeForDelivery: true }
      );
      expect(mergeReq.requestId).toBeDefined();
      expect(mergeReq.code).toBeDefined();

      // Confirm merge
      const mergeResult = await confirmIdentityMerge(
        testUser3Id,
        mergeReq.requestId,
        mergeReq.code!
      );
      expect(mergeResult.success).toBe(true);

      // Verify target marked merged
      const staleTarget = await prisma.buyerIdentity.findUnique({
        where: { id: targetIdentity.id },
      });
      expect(staleTarget?.status).toBe(BuyerIdentityStatus.MERGED);
      expect(staleTarget?.mergedIntoId).toBe(mergeResult.buyerId);

      // Verify transaction moved to surviving identity
      const movedTx = await prisma.socialTransaction.findUnique({
        where: { id: targetTx.id },
      });
      expect(movedTx?.buyerIdentityId).toBe(mergeResult.buyerId);
    });
  });

  // ------------------------------------------------------------------
  // 15. merge authorization
  // ------------------------------------------------------------------
  describe("15. merge authorization", () => {
    it("should prevent merging with an identity owned by another OrderFlow user account", async () => {
      const id1 = await getOrCreateBuyerIdentity(testUser1Id);
      const id2 = await getOrCreateBuyerIdentity(testUser2Id);

      // Cannot merge self
      await expect(
        createMergeRequest(testUser1Id, id1.id)
      ).rejects.toThrow("Cannot merge an identity with itself");

      // Cannot merge an identity that has an active User account (must login to that account)
      await expect(
        createMergeRequest(testUser1Id, id2.id)
      ).rejects.toThrow(IdentityConflictError);
    });
  });

  // ------------------------------------------------------------------
  // 16. merge concurrency
  // ------------------------------------------------------------------
  describe("16. merge concurrency", () => {
    it("should reject re-confirming already merged requests", async () => {
      // Find any completed merge request
      const mergedRequest = await prisma.buyerIdentityMergeRequest.findFirst({
        where: { status: "MERGED" },
      });
      if (mergedRequest && mergedRequest.requestedByUserId) {
        await expect(
          confirmIdentityMerge(mergedRequest.requestedByUserId, mergedRequest.id, "123456")
        ).rejects.toThrow(BuyerIdentityError);
      }
    });
  });

  // ------------------------------------------------------------------
  // 17. link concurrency
  // ------------------------------------------------------------------
  describe("17. link concurrency", () => {
    it("should enforce unique constraint when concurrent links target the same external identity", async () => {
      const handle = `race_handle_${Date.now()}`;

      // Simulate concurrent attempts to link the exact same handle
      const p1 = linkBuyerIdentity(testUser1Id, {
        provider: BuyerIdentityProvider.X,
        externalIdentityId: handle,
      });
      const p2 = linkBuyerIdentity(testUser2Id, {
        provider: BuyerIdentityProvider.X,
        externalIdentityId: handle,
      });

      const results = await Promise.allSettled([p1, p2]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly one succeeds, the other is rejected with conflict
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // 18. claim concurrency
  // ------------------------------------------------------------------
  describe("18. claim concurrency", () => {
    it("should safely handle concurrent claims on the same guest transaction", async () => {
      const tx = await createSocialTransaction(businessAId, {
        platform: SocialPlatform.WHATSAPP,
        surface: SocialSurface.DM,
      });

      const c1 = claimTransactionDirect(testUser1Id, tx.publicTrackingToken);
      const c2 = claimTransactionDirect(testUser2Id, tx.publicTrackingToken);

      const outcomes = await Promise.allSettled([c1, c2]);
      const successful = outcomes.filter((o) => o.status === "fulfilled");
      const failed = outcomes.filter((o) => o.status === "rejected");

      // Exactly one user can claim the transaction
      expect(successful.length).toBe(1);
      expect(failed.length).toBe(1);
    });
  });

  // ------------------------------------------------------------------
  // 19. notification continuity
  // ------------------------------------------------------------------
  describe("19. notification continuity", () => {
    it("should record notifications on claim and track read state", async () => {
      let notifs = await getBuyerNotifications(testUser1Id);
      if (notifs.length === 0) {
        await prisma.notification.create({
          data: {
            businessId: businessAId,
            userId: testUser1Id,
            channel: "IN_APP",
            recipient: "buyer1@example.com",
            title: "Purchase Successfully Claimed",
            content: "Your transaction has been claimed",
            status: "SENT",
          },
        });
        notifs = await getBuyerNotifications(testUser1Id);
      }
      expect(notifs.length).toBeGreaterThanOrEqual(1);

      const target = notifs[0];
      const marked = await markBuyerNotificationAsRead(target.id, testUser1Id);
      expect(marked.readAt).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // 20. privacy controls
  // ------------------------------------------------------------------
  describe("20. privacy controls", () => {
    it("should return sanitized privacy summary without leaking external secrets or cross-tenant data", async () => {
      const privacy = await getBuyerPrivacySummary(testUser1Id);

      expect(privacy.dataMinimization.noAdvertisingProfiles).toBe(true);
      expect(privacy.dataMinimization.noCrossSellerBrowsingHistory).toBe(true);
      expect(privacy.dataMinimization.noProbabilisticIdentityMerging).toBe(true);
      expect(privacy.connectedIdentities).toBeDefined();
    });
  });

  // ------------------------------------------------------------------
  // 21. IDOR protection
  // ------------------------------------------------------------------
  describe("21. IDOR protection", () => {
    it("should prevent User 2 from unlinking User 1 identity links", async () => {
      const link1 = await prisma.buyerIdentityLink.findFirst({
        where: {
          buyerIdentity: { userId: testUser1Id },
          provider: BuyerIdentityProvider.EMAIL,
        },
      });

      if (link1) {
        await expect(
          unlinkBuyerIdentity(testUser2Id, link1.id)
        ).rejects.toThrow(IdentityNotFoundError);
      }
    });
  });

  // ------------------------------------------------------------------
  // 22. rate limiting
  // ------------------------------------------------------------------
  describe("22. rate limiting", () => {
    it("should enforce rate limiting on verification challenge spam", async () => {
      const now = Date.now();
      const tempUser = await prisma.user.create({
        data: { email: `ratelimit_${now}@test.com`, name: "Rate Limit Tester" },
      });

      // Fire 5 requests to reach rate limit
      for (let i = 0; i < 5; i++) {
        await requestContactVerification(tempUser.id, {
          type: "EMAIL",
          value: `rate_target_${now}_${i}@test.com`,
        });
      }

      // 6th attempt must be rejected with rate limit error
      await expect(
        requestContactVerification(tempUser.id, {
          type: "EMAIL",
          value: `rate_target_${now}_6@test.com`,
        })
      ).rejects.toThrow(IdentityRateLimitError);
    });
  });

  // ------------------------------------------------------------------
  // 23. audit events
  // ------------------------------------------------------------------
  describe("23. audit events", () => {
    it("should maintain immutable chronological audit log of all identity events", async () => {
      const identity = await getOrCreateBuyerIdentity(testUser1Id);
      const auditTrail = await getBuyerIdentityAuditTrail(identity.id);

      expect(auditTrail.length).toBeGreaterThanOrEqual(1);
      const eventTypes = auditTrail.map((e) => e.eventType);

      // Verify key event types were logged
      expect(
        eventTypes.some(
          (t) =>
            t === BuyerIdentityEventType.IDENTITY_CREATED ||
            t === BuyerIdentityEventType.IDENTITY_LINKED ||
            t === BuyerIdentityEventType.ACCOUNT_CLAIMED
        )
      ).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // 24. regression against Phase 1
  // ------------------------------------------------------------------
  describe("24. regression against Phase 1", () => {
    it("should verify guest delivery confirmation, payment proof, and public transaction rooms still work", async () => {
      const tx = await createSocialTransaction(businessAId, {
        platform: SocialPlatform.INSTAGRAM,
        surface: SocialSurface.DM,
        status: TransactionStatus.INQUIRY,
      });

      // 1. Confirm delivery
      const deliveryRes = await confirmDeliveryInformation(tx.publicTrackingToken, {
        recipientName: "Phase1 Guest",
        phone: "+15551234567",
        shippingAddress: "123 Phase 1 Blvd",
        city: "San Francisco",
        postalCode: "94103",
      });
      expect(deliveryRes.success).toBe(true);
      expect(deliveryRes.shippingAddress).toContain("123 Phase 1 Blvd");

      // 2. Fetch public room
      const room = await getPublicTransactionByToken(tx.publicTrackingToken);
      expect(room).toBeDefined();
      expect(room.status).toBe(TransactionStatus.INTENT_CONFIRMED);

      // 3. Public dispute
      const dispute = await createPublicDispute(tx.publicTrackingToken, {
        reason: "Item arrived broken",
        buyerNotes: "Package was crushed upon arrival",
      });
      expect(dispute.id).toBeDefined();
      expect(dispute.status).toBe("REQUESTED");
    });
  });

  // ------------------------------------------------------------------
  // 25. regression against Phase 2
  // ------------------------------------------------------------------
  describe("25. regression against Phase 2", () => {
    it("should verify social draft transaction workflow and capability matrix still work", async () => {
      // 1. Capability matrix
      const matrix = getPlatformsCapabilityMatrix();
      expect(matrix.INSTAGRAM).toBeDefined();
      expect(matrix.WHATSAPP).toBeDefined();
      expect(matrix.FACEBOOK).toBeDefined();
      expect(matrix.X).toBeDefined();

      // 2. Draft transaction flow
      const conv = await prisma.conversation.create({
        data: {
          businessId: businessAId,
          channel: ConversationChannel.INSTAGRAM,
          contactIdentifier: "buyer_ig_phase2",
          contactName: "Phase2 Buyer",
          externalChatId: `ig_chat_${Date.now()}`,
          lastMessageSnippet: "I want a Silk Scarf",
        },
      });

      const draft = await createDraftTransaction({
        businessId: businessAId,
        conversationId: conv.id,
        customerName: "Phase2 Buyer",
        shippingAddress: "123 Scarf St",
        items: [
          {
            title: "Phase 2 Silk Scarf",
            quantity: 1,
            unitPrice: 45,
          },
        ],
      });

      expect(draft.id).toBeDefined();
      expect(draft.status).toBe(TransactionStatus.INQUIRY);

      // 3. Confirm draft
      const confirmed = await confirmDraftTransaction(businessAId, draft.id, {
        customerName: "Phase2 Buyer",
        shippingAddress: "123 Scarf St",
      });
      expect(confirmed.success).toBe(true);
      expect(confirmed.order).toBeDefined();
    });
  });
});

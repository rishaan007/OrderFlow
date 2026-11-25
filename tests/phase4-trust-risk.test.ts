import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import { prisma } from "../src/lib/prisma";
import { getTenantDb } from "../src/lib/tenant";
import {
  TrustSignalCategory,
  TrustSignalDirection,
  TrustSignalSeverity,
  TransactionRiskLevel,
  RiskReviewStatus,
  DisputeStatus,
  DisputeCategory,
  DisputeDecisionRecommendation,
  EvidenceType,
  EvidenceVerificationState,
  TimelineActor,
  TimelineVisibility,
  OrderStatus,
  PaymentStatus,
  PaymentRecordStatus,
  TransactionStatus,
  SocialPlatform,
  SocialSurface,
} from "@prisma/client";
import {
  recordTrustSignal,
  invalidateTrustSignal,
  getTrustSignals,
  calculateTemporalWeight,
  isSignalActive,
} from "../src/lib/trust-signals";
import {
  getSellerTrustProfile,
  getBuyerTrustProfile,
  getBuyerTrustProfileForSeller,
} from "../src/lib/trust-profile";
import {
  assessTransactionRisk,
  assignRiskReview,
  resolveRiskReview,
  getBusinessRiskAssessments,
  getBusinessRiskReviews,
} from "../src/lib/risk-engine";
import {
  createDisputeCase,
  requestDisputeEvidence,
  submitDisputeEvidence,
  reviewDisputeCase,
  resolveDisputeCase,
  escalateDisputeCase,
  getDisputeById,
  getBusinessDisputes,
  computeEvidenceHash,
  evaluateDisputeRecommendation,
} from "../src/lib/disputes";
import { getOrCreateBuyerIdentity } from "../src/lib/buyer-identity";
import { createSocialTransaction } from "../src/lib/transactions";

let businessAId: string;
let businessBId: string;
let tenantA: ReturnType<typeof getTenantDb>;
let tenantB: ReturnType<typeof getTenantDb>;

let sellerUserAId: string;
let sellerUserBId: string;
let buyerUser1Id: string;
let buyerIdentity1Id: string;

beforeAll(async () => {
  const timestamp = Date.now();

  // 1. Create two isolated business tenants
  const bA = await prisma.business.upsert({
    where: { slug: `phase4-seller-tenant-a-${timestamp}` },
    update: {},
    create: {
      name: "Phase 4 Trust Tenant A",
      slug: `phase4-seller-tenant-a-${timestamp}`,
      currency: "USD",
    },
  });

  const bB = await prisma.business.upsert({
    where: { slug: `phase4-seller-tenant-b-${timestamp}` },
    update: {},
    create: {
      name: "Phase 4 Trust Tenant B",
      slug: `phase4-seller-tenant-b-${timestamp}`,
      currency: "USD",
    },
  });

  businessAId = bA.id;
  businessBId = bB.id;
  tenantA = getTenantDb(businessAId);
  tenantB = getTenantDb(businessBId);

  // 2. Create users
  const uA = await prisma.user.create({
    data: {
      email: `seller_a_${timestamp}@example.com`,
      name: "Seller Alice",
    },
  });
  sellerUserAId = uA.id;

  const uB = await prisma.user.create({
    data: {
      email: `seller_b_${timestamp}@example.com`,
      name: "Seller Bob",
    },
  });
  sellerUserBId = uB.id;

  const uBuyer = await prisma.user.create({
    data: {
      email: `buyer_${timestamp}@example.com`,
      name: "Charlie Buyer",
    },
  });
  buyerUser1Id = uBuyer.id;

  // Link users to business membership
  await prisma.businessMember.createMany({
    data: [
      { businessId: businessAId, userId: sellerUserAId, role: "OWNER" },
      { businessId: businessBId, userId: sellerUserBId, role: "OWNER" },
    ],
  });

  // 3. Create buyer identity
  const buyerIdRecord = await getOrCreateBuyerIdentity(buyerUser1Id);
  buyerIdentity1Id = buyerIdRecord.id;
});

describe("Phase 4: Trust Signal Infrastructure", () => {
  it("records positive and negative trust signals with provenance", async () => {
    const positiveSignal = await recordTrustSignal({
      businessId: businessAId,
      buyerIdentityId: buyerIdentity1Id,
      signalType: "SUCCESSFUL_PAYMENT",
      category: TrustSignalCategory.PAYMENT,
      direction: TrustSignalDirection.POSITIVE,
      severity: TrustSignalSeverity.LOW,
      scoreValue: 1.0,
      confidence: 1.0,
      explanation: "Payment confirmed on first attempt via verified UPI",
      sourceType: "PAYMENT_GATEWAY",
    });

    expect(positiveSignal.id).toBeDefined();
    expect(positiveSignal.businessId).toBe(businessAId);
    expect(positiveSignal.buyerIdentityId).toBe(buyerIdentity1Id);
    expect(positiveSignal.direction).toBe(TrustSignalDirection.POSITIVE);
    expect(isSignalActive(positiveSignal)).toBe(true);

    const negativeSignal = await recordTrustSignal({
      businessId: businessAId,
      buyerIdentityId: buyerIdentity1Id,
      signalType: "PAYMENT_REJECTED",
      category: TrustSignalCategory.PAYMENT,
      direction: TrustSignalDirection.NEGATIVE,
      severity: TrustSignalSeverity.HIGH,
      scoreValue: -2.0,
      confidence: 0.9,
      explanation: "Payment rejected due to invalid reference number",
      sourceType: "MANUAL_VERIFICATION",
    });

    expect(negativeSignal.id).toBeDefined();
    expect(negativeSignal.direction).toBe(TrustSignalDirection.NEGATIVE);
    expect(negativeSignal.severity).toBe(TrustSignalSeverity.HIGH);
  });

  it("calculates exponential temporal decay correctly", () => {
    const now = new Date();
    // 0 days old -> weight 1.0
    expect(calculateTemporalWeight(now, 90, now)).toBe(1.0);

    // Half life (90 days old with 90 day half-life) -> weight 0.5
    const halfLifeAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const weightHalf = calculateTemporalWeight(halfLifeAgo, 90, now);
    expect(weightHalf).toBeCloseTo(0.5, 2);

    // Two half lives (180 days old) -> weight 0.25
    const twoHalfLivesAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
    const weightQuarter = calculateTemporalWeight(twoHalfLivesAgo, 90, now);
    expect(weightQuarter).toBeCloseTo(0.25, 2);
  });

  it("correctly evaluates signal active state and expiration", () => {
    const now = new Date();
    const activeSignal = {
      invalidatedAt: null,
      validUntil: new Date(now.getTime() + 10000),
    };
    expect(isSignalActive(activeSignal, now)).toBe(true);

    const expiredSignal = {
      invalidatedAt: null,
      validUntil: new Date(now.getTime() - 10000),
    };
    expect(isSignalActive(expiredSignal, now)).toBe(false);

    const deactivatedSignal = {
      invalidatedAt: new Date(),
      validUntil: null,
    };
    expect(isSignalActive(deactivatedSignal, now)).toBe(false);
  });

  it("invalidates trust signals with audit logging", async () => {
    const signal = await recordTrustSignal({
      businessId: businessAId,
      signalType: "CARRIER_DELAY",
      category: TrustSignalCategory.FULFILLMENT,
      direction: TrustSignalDirection.NEGATIVE,
      severity: TrustSignalSeverity.MEDIUM,
      explanation: "Carrier reported route blockage",
      sourceType: "CARRIER_API",
    });

    const invalidated = await invalidateTrustSignal(
      signal.id,
      "Carrier cleared route; delay was erroneous",
      sellerUserAId
    );

    expect(isSignalActive(invalidated)).toBe(false);

    // Verify audit event was recorded
    const auditEvent = await prisma.trustRiskAuditEvent.findFirst({
      where: {
        eventType: "SIGNAL_INVALIDATED",
        businessId: businessAId,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(auditEvent).not.toBeNull();
    expect(auditEvent?.actorId).toBe(sellerUserAId);
    expect(auditEvent?.reason).toContain("Carrier cleared route");
  });

  it("filters trust signals correctly by buyerIdentity and active status", async () => {
    const buyerSignals = await getTrustSignals({
      buyerIdentityId: buyerIdentity1Id,
      activeOnly: true,
    });

    expect(buyerSignals.length).toBeGreaterThan(0);
    buyerSignals.forEach((s) => {
      expect(s.buyerIdentityId).toBe(buyerIdentity1Id);
      expect(isSignalActive(s)).toBe(true);
    });
  });
});

describe("Phase 4: Buyer Trust Profile & Strict Cross-Seller Privacy", () => {
  it("calculates buyer trust profile with explainable metrics", async () => {
    const profile = await getBuyerTrustProfile(buyerIdentity1Id);

    expect(profile.buyerIdentityId).toBe(buyerIdentity1Id);
    expect(profile.modelVersion).toBe("v1");
    expect(profile.metrics.completedTransactions).toBeDefined();
    expect(profile.metrics.cancellationRate).toBeDefined();
    expect(profile.metrics.disputeRate).toBeDefined();
    expect(profile.metrics.accountAgeDays).toBeDefined();
    expect(profile.summary.disputeRateBucket).toBeDefined();
  });

  it("enforces cross-seller privacy: Seller A cannot see Seller B transaction details", async () => {
    // 1. Create a transaction for Buyer with Seller B
    const txB = await createSocialTransaction(businessBId, {
      platform: SocialPlatform.INSTAGRAM,
      surface: SocialSurface.DM,
      status: TransactionStatus.COMPLETED,
      buyerNotes: "Confidential order from Seller B",
      sellerNotes: "Private Seller B internal remarks",
    });

    await prisma.socialTransaction.update({
      where: { id: txB.id },
      data: { buyerIdentityId: buyerIdentity1Id },
    });

    // 2. Query buyer trust summary as Seller A
    const sellerAView = await getBuyerTrustProfileForSeller(businessAId, buyerIdentity1Id);

    // Verification: Seller A sees aggregated platform confidence, NOT private details
    expect(sellerAView.buyerIdentityId).toBe(buyerIdentity1Id);
    expect(sellerAView.isEstablishedBuyer).toBeDefined();
    expect(sellerAView.verificationLevel).toBeDefined();
    expect(sellerAView.disputeRateBucket).toBeDefined();
    expect(sellerAView.accountAgeBucket).toBeDefined();
    expect(sellerAView.explanation).toBeDefined();

    // Ensure raw fields from Seller B are absent from the returned object
    const rawString = JSON.stringify(sellerAView);
    expect(rawString).not.toContain(businessBId);
    expect(rawString).not.toContain("Confidential order from Seller B");
    expect(rawString).not.toContain("Private Seller B internal remarks");
  });
});

describe("Phase 4: Seller Trust Profile & Mathematical Provenance", () => {
  it("calculates seller trust profile with mathematical provenance and observation windows", async () => {
    // Seed an order for Seller A to populate metrics
    const order = await prisma.order.create({
      data: {
        businessId: businessAId,
        orderNumber: `ORD-P4-${Date.now()}`,
        status: OrderStatus.DELIVERED,
        paymentStatus: PaymentStatus.PAID,
        subtotal: 120.0,
        totalAmount: 120.0,
        amountPaid: 120.0,
        currency: "USD",
        notes: "Test Customer Order",
      },
    });

    const profile = await getSellerTrustProfile(businessAId, { windowDays: 180 });

    expect(profile.businessId).toBe(businessAId);
    expect(profile.modelVersion).toBe("v1");
    expect(profile.calculatedAt).toBeDefined();

    // Verify all 7 required metrics
    expect(profile.metrics.fulfillmentRate).toBeDefined();
    expect(profile.metrics.fulfillmentRate.observationWindow.days).toBe(180);
    expect(profile.metrics.fulfillmentRate.eligibilityCriteria).toBeDefined();
    expect(profile.metrics.fulfillmentRate.sampleSize).toBeGreaterThan(0);

    expect(profile.metrics.completionRate).toBeDefined();
    expect(profile.metrics.cancellationRate).toBeDefined();
    expect(profile.metrics.refundRate).toBeDefined();
    expect(profile.metrics.disputeRate).toBeDefined();
    expect(profile.metrics.deliverySuccessRate).toBeDefined();
    expect(profile.metrics.averageFulfillmentHours).toBeDefined();

    expect(profile.summary.fulfillmentRatePercentage).toBeGreaterThan(0);
  });
});

describe("Phase 4: Transaction Risk Assessment & Risk Review", () => {
  let lowRiskTxId: string;
  let highRiskTxId: string;

  it("evaluates transaction risk deterministically with explainable reasons", async () => {
    // 1. Create a standard transaction (Low Risk)
    const tx1 = await createSocialTransaction(businessAId, {
      platform: SocialPlatform.INSTAGRAM,
      surface: SocialSurface.DM,
      status: TransactionStatus.INQUIRY,
    });
    lowRiskTxId = tx1.id;

    // Link buyer
    await prisma.socialTransaction.update({
      where: { id: tx1.id },
      data: { buyerIdentityId: buyerIdentity1Id },
    });

    const assessmentLow = await assessTransactionRisk(lowRiskTxId);

    expect(assessmentLow.assessmentId).toBeDefined();
    expect(assessmentLow.transactionId).toBe(lowRiskTxId);
    expect(assessmentLow.score).toBeLessThan(70);
    expect(assessmentLow.modelVersion).toBe("v1");
    expect(assessmentLow.reasons).toBeInstanceOf(Array);
  });

  it("escalates risk level and triggers RiskReview for high-risk signals", async () => {
    // 2. Create a high-risk transaction: high value ($2000), rejected payment, unverified buyer
    const orderHigh = await prisma.order.create({
      data: {
        businessId: businessAId,
        orderNumber: `ORD-RISK-${Date.now()}`,
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
        subtotal: 2500.0,
        totalAmount: 2500.0,
        amountPaid: 0.0,
        currency: "USD",
        notes: "Anonymous High Risk Order",
      },
    });

    // Add a rejected payment attempt
    await prisma.payment.create({
      data: {
        businessId: businessAId,
        orderId: orderHigh.id,
        amount: 2500.0,
        currency: "USD",
        status: PaymentRecordStatus.REJECTED,
      },
    });

    const txHigh = await createSocialTransaction(businessAId, {
      platform: SocialPlatform.MANUAL,
      surface: SocialSurface.DIRECT_CHAT,
      status: TransactionStatus.PAYMENT_PENDING,
      orderId: orderHigh.id,
    });
    highRiskTxId = txHigh.id;

    const assessmentHigh = await assessTransactionRisk(highRiskTxId);

    expect(assessmentHigh.score).toBeGreaterThanOrEqual(40);
    expect(assessmentHigh.reviewRequired).toBe(true);
    expect(assessmentHigh.reasons.some((r) => r.code === "PAYMENT_FAILED")).toBe(true);

    // Verify RiskReview was created in the database
    const review = await prisma.riskReview.findFirst({
      where: { assessmentId: assessmentHigh.assessmentId },
    });
    expect(review).not.toBeNull();
    expect(review?.status).toBe(RiskReviewStatus.OPEN);
  });

  it("manages the RiskReview lifecycle: assignment and resolution", async () => {
    const reviews = await getBusinessRiskReviews(businessAId, { status: RiskReviewStatus.OPEN });
    expect(reviews.items.length).toBeGreaterThan(0);
    const targetReview = reviews.items[0];

    // 1. Assign review
    const assigned = await assignRiskReview(
      businessAId,
      targetReview.id,
      sellerUserAId,
      "Taking over verification of payment slip"
    );
    expect(assigned.status).toBe(RiskReviewStatus.IN_PROGRESS);
    expect(assigned.assignedToUserId).toBe(sellerUserAId);

    // 2. Resolve review
    const resolved = await resolveRiskReview(
      businessAId,
      targetReview.id,
      "APPROVED",
      "Manual phone verification succeeded and bank transfer cleared",
      sellerUserAId
    );
    expect(resolved.status).toBe(RiskReviewStatus.RESOLVED);
    expect(resolved.decision).toBe("APPROVED");
    expect(resolved.reviewedAt).toBeDefined();

    // 3. Verify audit record
    const audit = await prisma.trustRiskAuditEvent.findFirst({
      where: { assessmentId: targetReview.assessmentId, eventType: "REVIEW_RESOLVED" },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(sellerUserAId);
  });
});

describe("Phase 4: Dispute Case Management & Evidence Chain", () => {
  let disputeTxId: string;
  let testDisputeId: string;
  let orderForDisputeId: string;

  beforeAll(async () => {
    const order = await prisma.order.create({
      data: {
        businessId: businessAId,
        orderNumber: `ORD-DISP-${Date.now()}`,
        status: OrderStatus.CONFIRMED,
        paymentStatus: PaymentStatus.PAID,
        subtotal: 180.0,
        totalAmount: 180.0,
        amountPaid: 180.0,
        currency: "USD",
        notes: "Dispute Buyer Order",
      },
    });
    orderForDisputeId = order.id;

    const tx = await createSocialTransaction(businessAId, {
      platform: SocialPlatform.INSTAGRAM,
      surface: SocialSurface.DM,
      status: TransactionStatus.ORDER_CREATED,
      orderId: order.id,
    });
    disputeTxId = tx.id;
  });

  it("creates a dispute case with structured categories and timeline record", async () => {
    const dispute = await createDisputeCase(
      {
        transactionId: disputeTxId,
        businessId: businessAId,
        orderId: orderForDisputeId,
        category: DisputeCategory.DAMAGED_ITEM,
        reason: "Item arrived broken in transit",
        buyerNotes: "Outer box was crushed and ceramic bowl cracked",
        claimantType: "BUYER",
        refundAmount: 180.0,
      },
      buyerUser1Id
    );

    testDisputeId = dispute.id;
    expect(dispute.id).toBeDefined();
    expect(dispute.status).toBe(DisputeStatus.OPEN);
    expect(dispute.category).toBe(DisputeCategory.DAMAGED_ITEM);
    expect(dispute.decisionRecommendation).toBe(DisputeDecisionRecommendation.INSUFFICIENT_EVIDENCE);

    // Verify timeline event
    const timelineEvent = await prisma.transactionTimelineEvent.findFirst({
      where: { transactionId: disputeTxId, eventType: "DISPUTE_RAISED" },
    });
    expect(timelineEvent).not.toBeNull();
    expect(timelineEvent?.actor).toBe(TimelineActor.BUYER);
  });

  it("requests evidence and updates dispute status to EVIDENCE_REQUESTED", async () => {
    const updated = await requestDisputeEvidence(
      testDisputeId,
      businessAId,
      "BUYER",
      "Please upload clear photos of the damaged packaging and item",
      sellerUserAId
    );

    expect(updated.status).toBe(DisputeStatus.EVIDENCE_REQUESTED);

    const audit = await prisma.trustRiskAuditEvent.findFirst({
      where: { disputeId: testDisputeId, eventType: "DISPUTE_EVIDENCE_REQUESTED" },
    });
    expect(audit).not.toBeNull();
  });

  it("submits evidence with SHA-256 tamper-evident integrity hash", async () => {
    const mediaUrl = "https://cdn.example.com/evidence/damaged-bowl.jpg";
    const notes = "Photo showing deep fracture along the side of the ceramic bowl";

    const expectedHash = computeEvidenceHash(`${mediaUrl}|${notes}|${EvidenceType.DISPUTE_EVIDENCE}`);

    const result = await submitDisputeEvidence(
      testDisputeId,
      {
        evidenceType: EvidenceType.DISPUTE_EVIDENCE,
        source: "BUYER_PORTAL",
        actor: TimelineActor.BUYER,
        mediaUrl,
        notes,
      },
      buyerUser1Id
    );

    expect(result.evidence.id).toBeDefined();
    expect(result.evidence.contentHash).toBe(expectedHash);
    expect(result.evidence.verificationState).toBe(EvidenceVerificationState.USER_PROVIDED);
    expect(result.dispute.status).toBe(DisputeStatus.EVIDENCE_SUBMITTED);
    // Since buyer evidence is submitted, recommendation should require seller evidence next
    expect(result.dispute.decisionRecommendation).toBe(DisputeDecisionRecommendation.SELLER_EVIDENCE_REQUIRED);
  });

  it("seller submits carrier dispatch evidence and achieves READY_FOR_REVIEW", async () => {
    const sellerEvidence = await submitDisputeEvidence(
      testDisputeId,
      {
        evidenceType: EvidenceType.COMMUNICATION_TRANSCRIPT,
        source: "SELLER_DESK",
        actor: TimelineActor.SELLER,
        notes: "Carrier tracking log shows fragile handling sticker was affixed at dispatch",
      },
      sellerUserAId
    );

    // Both parties have provided evidence, so recommendation should transition to READY_FOR_REVIEW
    expect(sellerEvidence.dispute.decisionRecommendation).toBe(DisputeDecisionRecommendation.READY_FOR_REVIEW);
  });

  it("reviews the dispute case and transitions to UNDER_REVIEW", async () => {
    const reviewed = await reviewDisputeCase(
      testDisputeId,
      businessAId,
      sellerUserAId,
      "Reviewed photos; damage appears consistent with transit mishandling"
    );

    expect(reviewed.status).toBe(DisputeStatus.UNDER_REVIEW);
    expect(reviewed.decisionRecommendation).toBe(DisputeDecisionRecommendation.READY_FOR_REVIEW);
  });

  it("resolves the dispute case with refund and updates Order payment status", async () => {
    const resolved = await resolveDisputeCase(
      testDisputeId,
      businessAId,
      {
        resolution: "REFUNDED",
        resolutionReason: "Carrier mishandling approved for full buyer refund",
        refundAmount: 180.0,
        notes: "Credit issued to customer account",
      },
      sellerUserAId
    );

    expect(resolved.status).toBe(DisputeStatus.REFUNDED);
    expect(resolved.resolvedAt).toBeDefined();
    expect(resolved.resolvedByUserId).toBe(sellerUserAId);

    // Verify order was marked REFUNDED and CANCELLED
    const order = await prisma.order.findUnique({
      where: { id: orderForDisputeId },
    });
    expect(order?.paymentStatus).toBe(PaymentStatus.REFUNDED);
    expect(order?.status).toBe(OrderStatus.CANCELLED);

    // Verify refund evidence was automatically recorded
    const refundEvidence = await prisma.transactionEvidence.findFirst({
      where: { disputeId: testDisputeId, evidenceType: EvidenceType.REFUND_RECORD },
    });
    expect(refundEvidence).not.toBeNull();
  });
});

describe("Phase 4: Multi-Tenant Security & IDOR Isolation", () => {
  it("prevents Tenant B from viewing or resolving Tenant A disputes", async () => {
    // Create a dispute in Tenant A
    const txA = await createSocialTransaction(businessAId, {
      platform: SocialPlatform.INSTAGRAM,
      surface: SocialSurface.DM,
      status: TransactionStatus.INQUIRY,
    });

    const disputeA = await createDisputeCase({
      transactionId: txA.id,
      businessId: businessAId,
      reason: "Tenant A private dispute",
      claimantType: "BUYER",
    });

    // 1. Tenant B attempting to fetch dispute A with businessId scoping
    const disputeForB = await getDisputeById(disputeA.id, businessBId);
    expect(disputeForB).toBeNull();

    // 2. Tenant B attempting to resolve dispute A
    await expect(
      resolveDisputeCase(
        disputeA.id,
        businessBId,
        { resolution: "RESOLVED", resolutionReason: "Malicious attempt by B" },
        sellerUserBId
      )
    ).rejects.toThrow(/not found or access denied/i);

    // 3. Tenant B attempting to review dispute A
    await expect(
      reviewDisputeCase(disputeA.id, businessBId, sellerUserBId, "Unauthorized review")
    ).rejects.toThrow(/not found or access denied/i);
  });

  it("prevents Tenant B from resolving Tenant A risk reviews", async () => {
    // Create review in Tenant A
    const assessmentA = await assessTransactionRisk(
      (await createSocialTransaction(businessAId, { platform: SocialPlatform.MANUAL, surface: SocialSurface.DIRECT_CHAT })).id
    );

    const reviewA = await prisma.riskReview.create({
      data: {
        businessId: businessAId,
        assessmentId: assessmentA.assessmentId,
        status: RiskReviewStatus.OPEN,
        reason: "Tenant A test risk review",
      },
    });

    // Tenant B attempting to resolve review A
    await expect(
      resolveRiskReview(
        businessBId,
        reviewA.id,
        "APPROVED",
        "Unauthorized resolution",
        sellerUserBId
      )
    ).rejects.toThrow(/access denied/i);
  });
});

describe("Phase 4: Concurrency & Tamper Integrity", () => {
  it("maintains evidence integrity: hash detects any payload modification", () => {
    const originalMedia = "https://cdn.example.com/item1.png";
    const originalNotes = "Clean condition photo";
    const originalHash = computeEvidenceHash(`${originalMedia}|${originalNotes}|${EvidenceType.PAYMENT_PROOF}`);

    // Tampered notes
    const tamperedNotes = "Damaged condition photo";
    const tamperedHash = computeEvidenceHash(`${originalMedia}|${tamperedNotes}|${EvidenceType.PAYMENT_PROOF}`);

    expect(originalHash).not.toBe(tamperedHash);
    expect(originalHash.length).toBe(64); // SHA-256 is 64 hex chars
  });

  it("handles concurrent evidence submissions safely", async () => {
    const tx = await createSocialTransaction(businessAId, {
      platform: SocialPlatform.INSTAGRAM,
      surface: SocialSurface.DM,
    });

    const dispute = await createDisputeCase({
      transactionId: tx.id,
      businessId: businessAId,
      reason: "Concurrent test dispute",
    });

    // Fire 3 simultaneous evidence submissions
    const submissions = await Promise.all([
      submitDisputeEvidence(dispute.id, {
        evidenceType: EvidenceType.DISPUTE_EVIDENCE,
        source: "UPLOAD",
        actor: TimelineActor.BUYER,
        notes: "Submission 1",
      }),
      submitDisputeEvidence(dispute.id, {
        evidenceType: EvidenceType.COMMUNICATION_TRANSCRIPT,
        source: "CHAT",
        actor: TimelineActor.SELLER,
        notes: "Submission 2",
      }),
      submitDisputeEvidence(dispute.id, {
        evidenceType: EvidenceType.CARRIER_TRACKING,
        source: "CARRIER",
        actor: TimelineActor.CARRIER,
        notes: "Submission 3",
      }),
    ]);

    expect(submissions).toHaveLength(3);

    const storedEvidence = await prisma.transactionEvidence.findMany({
      where: { disputeId: dispute.id },
    });
    expect(storedEvidence).toHaveLength(3);
  });
});

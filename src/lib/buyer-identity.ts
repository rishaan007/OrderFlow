import crypto from "crypto";
import {
  Prisma,
  BuyerIdentityProvider,
  BuyerIdentityStatus,
  BuyerVerificationPurpose,
  BuyerIdentityEventType,
  IdentityConfidence,
  TimelineActor,
  TimelineVisibility,
} from "@prisma/client";
import { prisma } from "./prisma";
import { logger } from "./logger";

/**
 * Phase 3 — Cross-platform buyer identity.
 *
 * Two concepts are deliberately kept apart:
 *   Customer       = a seller-scoped relationship, owned by a business tenant.
 *   BuyerIdentity  = a platform-level identity linking a person's verified
 *                    contact points / social identities across sellers.
 *
 * Nothing in this module ever returns data from another seller tenant.
 */

export class BuyerIdentityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "BUYER_IDENTITY_ERROR", status = 400) {
    super(message);
    this.name = "BuyerIdentityError";
    this.code = code;
    this.status = status;
  }
}

export class IdentityConflictError extends BuyerIdentityError {
  constructor(
    message = "This identity is already connected to another OrderFlow buyer account."
  ) {
    super(message, "IDENTITY_ALREADY_LINKED", 409);
  }
}

export class IdentityNotFoundError extends BuyerIdentityError {
  constructor(message = "Identity not found") {
    super(message, "IDENTITY_NOT_FOUND", 404);
  }
}

export class VerificationChallengeError extends BuyerIdentityError {
  constructor(message = "Verification code is invalid or has expired", code = "VERIFICATION_FAILED") {
    super(message, code, 400);
  }
}

export class IdentityRateLimitError extends BuyerIdentityError {
  constructor(message = "Too many attempts. Please try again later.") {
    super(message, "RATE_LIMITED", 429);
  }
}

// ------------------------------------------------------------------
// Normalization helpers — deterministic, never fuzzy
// ------------------------------------------------------------------

export function normalizeEmail(value?: string | null): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

export function normalizePhone(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return hasPlus ? `+${digits}` : digits;
}

export function normalizeExternalIdentity(
  provider: BuyerIdentityProvider,
  rawValue: string
): string | null {
  const raw = (rawValue ?? "").trim();
  if (!raw) return null;

  switch (provider) {
    case BuyerIdentityProvider.EMAIL:
      return normalizeEmail(raw);
    case BuyerIdentityProvider.PHONE:
    case BuyerIdentityProvider.WHATSAPP:
      return normalizePhone(raw);
    case BuyerIdentityProvider.INSTAGRAM:
    case BuyerIdentityProvider.X:
      // Platform usernames are case-insensitive and conventionally written with @.
      return raw.replace(/^@+/, "").toLowerCase() || null;
    case BuyerIdentityProvider.FACEBOOK:
      return raw.toLowerCase() || null;
    case BuyerIdentityProvider.ORDERFLOW_ACCOUNT:
      return raw;
    default:
      return raw;
  }
}

export function maskIdentifier(value?: string | null): string | null {
  if (!value) return null;
  if (value.includes("@")) {
    const [local, domain] = value.split("@");
    const visible = local.slice(0, 1);
    return `${visible}${"•".repeat(Math.max(1, Math.min(6, local.length - 1)))}@${domain}`;
  }
  const digits = value.replace(/[^\d]/g, "");
  if (digits.length >= 4) {
    return `${value.startsWith("+") ? "+" : ""}${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  }
  return `${value.slice(0, 2)}${"•".repeat(Math.max(1, value.length - 2))}`;
}

function hashSecret(secret: string): string {
  return crypto.createHash("sha256").update(secret, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isSerializationFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2028")
  );
}

type DbClient = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------
// Audit trail
// ------------------------------------------------------------------

export async function recordIdentityEvent(
  client: DbClient,
  buyerIdentityId: string,
  eventType: BuyerIdentityEventType,
  options?: {
    actorType?: "BUYER" | "SELLER" | "SYSTEM";
    actorUserId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  return client.buyerIdentityAuditEvent.create({
    data: {
      buyerIdentityId,
      eventType,
      actorType: options?.actorType ?? "SYSTEM",
      actorUserId: options?.actorUserId ?? null,
      metadata: (options?.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function getBuyerIdentityAuditTrail(buyerIdentityId: string, take = 50) {
  return prisma.buyerIdentityAuditEvent.findMany({
    where: { buyerIdentityId },
    orderBy: { createdAt: "desc" },
    take: Math.min(200, Math.max(1, take)),
  });
}

// ------------------------------------------------------------------
// Identity lifecycle
// ------------------------------------------------------------------

/**
 * Returns the canonical buyer identity for an authenticated user.
 * Idempotent and concurrency-safe: `userId` is unique on buyer_identities.
 */
export async function getOrCreateBuyerIdentity(userId: string) {
  if (!userId) throw new BuyerIdentityError("User ID required", "USER_REQUIRED");

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw new IdentityNotFoundError("Authenticated buyer account not found");

  let identity = await prisma.buyerIdentity.findUnique({ where: { userId } });
  let created = false;

  if (!identity) {
    try {
      identity = await prisma.buyerIdentity.create({
        data: {
          userId: user.id,
          displayName: user.name,
          email: normalizeEmail(user.email),
          privacySettings: {
            allowCrossSellerIdentityResolution: true,
            marketingNotifications: false,
          },
          notificationPreferences: { transactionUpdates: true },
        },
      });
      created = true;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      identity = await prisma.buyerIdentity.findUnique({ where: { userId } });
    }
  }

  if (!identity) throw new IdentityNotFoundError("Unable to resolve buyer identity");
  if (identity.status !== BuyerIdentityStatus.ACTIVE) {
    throw new BuyerIdentityError("This buyer identity is not active", "IDENTITY_INACTIVE", 403);
  }

  // The authenticated session is itself deterministic proof of account control.
  await ensureAccountLink(identity.id, user.id);

  // An account email is an assertion, not a verified contact.
  if (identity.email) {
    await ensureAssertedContactLink(identity.id, BuyerIdentityProvider.EMAIL, identity.email);
  }

  await prisma.buyerIdentity.update({
    where: { id: identity.id },
    data: { lastSeenAt: new Date() },
  });

  if (created) {
    await recordIdentityEvent(prisma, identity.id, BuyerIdentityEventType.IDENTITY_CREATED, {
      actorType: "BUYER",
      actorUserId: user.id,
      metadata: { hasAccountEmail: Boolean(identity.email) },
    });
    logger.info("buyer_identity.created", {
      action: "buyer_identity_created",
      buyerIdentityId: identity.id,
    });
  }

  return identity;
}

async function ensureAccountLink(identityId: string, userId: string) {
  try {
    await prisma.buyerIdentityLink.create({
      data: {
        buyerIdentityId: identityId,
        provider: BuyerIdentityProvider.ORDERFLOW_ACCOUNT,
        externalIdentityId: userId,
        normalizedIdentifier: userId,
        confidence: IdentityConfidence.STRONGLY_VERIFIED,
        verificationMethod: "AUTHENTICATED_SESSION",
        verifiedAt: new Date(),
        lastVerifiedAt: new Date(),
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Already linked — deterministic no-op.
  }
}

async function ensureAssertedContactLink(
  identityId: string,
  provider: BuyerIdentityProvider,
  value: string
) {
  const normalized = normalizeExternalIdentity(provider, value);
  if (!normalized) return null;

  try {
    return await prisma.buyerIdentityLink.create({
      data: {
        buyerIdentityId: identityId,
        provider,
        externalIdentityId: normalized,
        normalizedIdentifier: normalized,
        confidence: IdentityConfidence.UNVERIFIED,
        verificationMethod: "ACCOUNT_ASSERTION",
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return null;
  }
}

export async function recomputeVerificationLevel(
  identityId: string,
  client: DbClient = prisma
): Promise<IdentityConfidence> {
  const links = await client.buyerIdentityLink.findMany({
    where: { buyerIdentityId: identityId },
    select: { confidence: true },
  });

  let level: IdentityConfidence = IdentityConfidence.UNVERIFIED;
  if (links.some((l) => l.confidence === IdentityConfidence.STRONGLY_VERIFIED)) {
    level = IdentityConfidence.STRONGLY_VERIFIED;
  } else if (links.some((l) => l.confidence === IdentityConfidence.VERIFIED)) {
    level = IdentityConfidence.VERIFIED;
  }

  await client.buyerIdentity.update({
    where: { id: identityId },
    data: { verificationLevel: level },
  });

  return level;
}

// ------------------------------------------------------------------
// Social / contact identity linking
// ------------------------------------------------------------------

export interface LinkIdentityInput {
  provider: BuyerIdentityProvider;
  externalIdentityId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Links an external identity assertion to the buyer identity.
 * New links are UNVERIFIED until proven. Ownership conflicts are rejected —
 * identities are never silently merged.
 */
export async function linkBuyerIdentity(userId: string, input: LinkIdentityInput) {
  const identity = await getOrCreateBuyerIdentity(userId);

  if (input.provider === BuyerIdentityProvider.ORDERFLOW_ACCOUNT) {
    throw new BuyerIdentityError(
      "OrderFlow account links are managed by authentication",
      "PROVIDER_NOT_LINKABLE"
    );
  }

  const normalized = normalizeExternalIdentity(input.provider, input.externalIdentityId);
  if (!normalized) {
    throw new BuyerIdentityError("Invalid identity value", "INVALID_IDENTITY_VALUE");
  }

  let link;
  try {
    link = await prisma.buyerIdentityLink.create({
      data: {
        buyerIdentityId: identity.id,
        provider: input.provider,
        externalIdentityId: normalized,
        normalizedIdentifier: normalized,
        confidence: IdentityConfidence.UNVERIFIED,
        verificationMethod: "BUYER_ASSERTED",
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.buyerIdentityLink.findUnique({
      where: {
        provider_externalIdentityId: {
          provider: input.provider,
          externalIdentityId: normalized,
        },
      },
    });
    if (existing && existing.buyerIdentityId === identity.id) {
      return { link: existing, alreadyLinked: true as const };
    }
    logger.warn("buyer_identity.link_conflict", {
      action: "identity_link_conflict",
      buyerIdentityId: identity.id,
      provider: input.provider,
    });
    throw new IdentityConflictError();
  }

  await recordIdentityEvent(prisma, identity.id, BuyerIdentityEventType.IDENTITY_LINKED, {
    actorType: "BUYER",
    actorUserId: userId,
    metadata: { provider: input.provider },
  });
  logger.info("buyer_identity.linked", {
    action: "identity_link_success",
    buyerIdentityId: identity.id,
    provider: input.provider,
  });

  return { link, alreadyLinked: false as const };
}

export async function unlinkBuyerIdentity(userId: string, linkId: string) {
  const identity = await getOrCreateBuyerIdentity(userId);

  const link = await prisma.buyerIdentityLink.findFirst({
    where: { id: linkId, buyerIdentityId: identity.id },
  });
  if (!link) throw new IdentityNotFoundError("Connected identity not found");

  if (link.provider === BuyerIdentityProvider.ORDERFLOW_ACCOUNT) {
    throw new BuyerIdentityError(
      "Your OrderFlow account is the anchor of this identity and cannot be unlinked",
      "CANNOT_UNLINK_ACCOUNT"
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.buyerIdentityLink.delete({ where: { id: link.id } });

    const clearsEmail =
      link.provider === BuyerIdentityProvider.EMAIL &&
      normalizeEmail(identity.email) === link.externalIdentityId;
    const clearsPhone =
      link.provider === BuyerIdentityProvider.PHONE &&
      normalizePhone(identity.phone) === link.externalIdentityId;

    if (clearsEmail || clearsPhone) {
      await tx.buyerIdentity.update({
        where: { id: identity.id },
        data: {
          ...(clearsEmail ? { email: null, emailVerifiedAt: null } : {}),
          ...(clearsPhone ? { phone: null, phoneVerifiedAt: null } : {}),
        },
      });
    }

    await recomputeVerificationLevel(identity.id, tx);

    await recordIdentityEvent(tx, identity.id, BuyerIdentityEventType.IDENTITY_UNLINKED, {
      actorType: "BUYER",
      actorUserId: userId,
      metadata: { provider: link.provider },
    });
  });

  logger.info("buyer_identity.unlinked", {
    action: "identity_unlink_success",
    buyerIdentityId: identity.id,
    provider: link.provider,
  });

  return { success: true };
}

// ------------------------------------------------------------------
// Verification (one-time codes, hashed at rest)
// ------------------------------------------------------------------

/**
 * Pluggable delivery adapter. OrderFlow never invents a delivery capability:
 * if no internal delivery webhook is configured the challenge is still created
 * (and auditable) but it is reported as undelivered.
 */
async function deliverVerificationCode(payload: {
  buyerIdentityId: string;
  channel: BuyerIdentityProvider;
  target: string;
  code: string;
  purpose: BuyerVerificationPurpose;
}): Promise<{ delivered: boolean; adapter: string }> {
  const endpoint = process.env.BUYER_IDENTITY_DELIVERY_WEBHOOK_URL;
  if (!endpoint) {
    return { delivered: false, adapter: "NOT_CONFIGURED" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.BUYER_IDENTITY_DELIVERY_WEBHOOK_SECRET
          ? { Authorization: `Bearer ${process.env.BUYER_IDENTITY_DELIVERY_WEBHOOK_SECRET}` }
          : {}),
      },
      body: JSON.stringify({
        buyerIdentityId: payload.buyerIdentityId,
        channel: payload.channel,
        target: payload.target,
        purpose: payload.purpose,
        code: payload.code,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return { delivered: res.ok, adapter: "WEBHOOK" };
  } catch (error) {
    logger.warn("buyer_identity.verification_delivery_failed", {
      action: "verification_delivery_failed",
      buyerIdentityId: payload.buyerIdentityId,
    });
    return { delivered: false, adapter: "WEBHOOK" };
  }
}

export interface RequestContactVerificationInput {
  type: "EMAIL" | "PHONE";
  value: string;
}

/**
 * Creates a one-time verification challenge for an email or phone number.
 * The plaintext code is returned only to server-side delivery adapters
 * (and to internal callers such as tests); it is never logged or stored.
 */
export async function requestContactVerification(
  userId: string,
  input: RequestContactVerificationInput,
  options?: { returnChallengeCodeForDelivery?: boolean }
) {
  const identity = await getOrCreateBuyerIdentity(userId);
  const provider =
    input.type === "EMAIL" ? BuyerIdentityProvider.EMAIL : BuyerIdentityProvider.PHONE;
  const normalized = normalizeExternalIdentity(provider, input.value);
  if (!normalized) {
    throw new BuyerIdentityError(
      input.type === "EMAIL" ? "Enter a valid email address" : "Enter a valid phone number",
      "INVALID_CONTACT"
    );
  }

  const purpose =
    input.type === "EMAIL"
      ? BuyerVerificationPurpose.EMAIL_VERIFICATION
      : BuyerVerificationPurpose.PHONE_VERIFICATION;

  // Rate limit: at most 5 challenges per identity/purpose per hour.
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.buyerVerificationChallenge.count({
    where: { buyerIdentityId: identity.id, purpose, createdAt: { gte: windowStart } },
  });
  if (recent >= 5) throw new IdentityRateLimitError();

  const owner = await prisma.buyerIdentityLink.findUnique({
    where: { provider_externalIdentityId: { provider, externalIdentityId: normalized } },
  });
  if (owner && owner.buyerIdentityId !== identity.id) {
    // Deliberately generic: do not confirm whose account holds this contact.
    throw new IdentityConflictError(
      "This contact cannot be verified on this account. If you believe this is an error, use account recovery."
    );
  }

  if (!owner) {
    await prisma.buyerIdentityLink.create({
      data: {
        buyerIdentityId: identity.id,
        provider,
        externalIdentityId: normalized,
        normalizedIdentifier: normalized,
        confidence: IdentityConfidence.UNVERIFIED,
        verificationMethod: "PENDING_VERIFICATION",
      },
    });
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.buyerVerificationChallenge.updateMany({
    where: { buyerIdentityId: identity.id, purpose, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const challenge = await prisma.buyerVerificationChallenge.create({
    data: {
      buyerIdentityId: identity.id,
      purpose,
      provider,
      target: normalized,
      codeHash: hashSecret(code),
      expiresAt,
    },
  });

  const delivery = await deliverVerificationCode({
    buyerIdentityId: identity.id,
    channel: provider,
    target: normalized,
    code,
    purpose,
  });

  await recordIdentityEvent(
    prisma,
    identity.id,
    BuyerIdentityEventType.IDENTITY_VERIFICATION_REQUESTED,
    {
      actorType: "BUYER",
      actorUserId: userId,
      metadata: { provider, delivered: delivery.delivered },
    }
  );

  logger.info("buyer_identity.verification_requested", {
    action: "identity_verification_requested",
    buyerIdentityId: identity.id,
    provider,
    delivered: delivery.delivered,
  });

  return {
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt,
    delivered: delivery.delivered,
    deliveryAdapter: delivery.adapter,
    ...(options?.returnChallengeCodeForDelivery ? { code } : {}),
  };
}

export async function verifyContactCode(
  userId: string,
  input: { challengeId: string; code: string }
) {
  const identity = await getOrCreateBuyerIdentity(userId);

  const challenge = await prisma.buyerVerificationChallenge.findFirst({
    where: { id: input.challengeId, buyerIdentityId: identity.id },
  });
  if (!challenge) throw new VerificationChallengeError();

  if (challenge.consumedAt) throw new VerificationChallengeError();
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new VerificationChallengeError("Verification code has expired", "VERIFICATION_EXPIRED");
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    throw new IdentityRateLimitError("Too many verification attempts");
  }

  const submitted = hashSecret((input.code ?? "").trim());
  const isValid = safeEqualHex(submitted, challenge.codeHash);

  if (!isValid) {
    const nextAttempts = challenge.attempts + 1;
    await prisma.buyerVerificationChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts: nextAttempts,
        ...(nextAttempts >= challenge.maxAttempts ? { consumedAt: new Date() } : {}),
      },
    });
    await recordIdentityEvent(
      prisma,
      identity.id,
      BuyerIdentityEventType.IDENTITY_VERIFICATION_FAILED,
      {
        actorType: "BUYER",
        actorUserId: userId,
        metadata: { provider: challenge.provider },
      }
    );
    throw new VerificationChallengeError();
  }

  if (!challenge.provider) throw new VerificationChallengeError();

  await prisma.$transaction(async (tx) => {
    const consumed = await tx.buyerVerificationChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new VerificationChallengeError();

    const link = await tx.buyerIdentityLink.findUnique({
      where: {
        provider_externalIdentityId: {
          provider: challenge.provider as BuyerIdentityProvider,
          externalIdentityId: challenge.target,
        },
      },
    });

    if (!link || link.buyerIdentityId !== identity.id) {
      throw new IdentityConflictError();
    }

    const alreadyVerified =
      link.confidence === IdentityConfidence.VERIFIED ||
      link.confidence === IdentityConfidence.STRONGLY_VERIFIED;

    await tx.buyerIdentityLink.update({
      where: { id: link.id },
      data: {
        confidence: alreadyVerified ? link.confidence : IdentityConfidence.VERIFIED,
        verificationMethod: "ONE_TIME_CODE",
        verifiedAt: link.verifiedAt ?? new Date(),
        lastVerifiedAt: new Date(),
      },
    });

    await tx.buyerIdentity.update({
      where: { id: identity.id },
      data:
        challenge.provider === BuyerIdentityProvider.EMAIL
          ? { email: challenge.target, emailVerifiedAt: new Date() }
          : { phone: challenge.target, phoneVerifiedAt: new Date() },
    });

    await recomputeVerificationLevel(identity.id, tx);

    await recordIdentityEvent(tx, identity.id, BuyerIdentityEventType.IDENTITY_VERIFIED, {
      actorType: "BUYER",
      actorUserId: userId,
      metadata: { provider: challenge.provider },
    });
  });

  logger.info("buyer_identity.verified", {
    action: "identity_verification_success",
    buyerIdentityId: identity.id,
    provider: challenge.provider,
  });

  return { success: true, provider: challenge.provider };
}

// ------------------------------------------------------------------
// Guest -> Buyer transaction claiming
// ------------------------------------------------------------------

export async function createClaimChallenge(userId: string, trackingToken: string) {
  if (!userId || !trackingToken) {
    throw new BuyerIdentityError("User ID and tracking token required", "CLAIM_INPUT_REQUIRED");
  }
  const identity = await getOrCreateBuyerIdentity(userId);

  const transaction = await prisma.socialTransaction.findUnique({
    where: { publicTrackingToken: trackingToken },
  });
  if (!transaction) {
    throw new IdentityNotFoundError("Transaction not found");
  }

  if (transaction.buyerUserId && transaction.buyerUserId !== userId) {
    throw new IdentityConflictError("This transaction is already associated with another OrderFlow account");
  }
  if (transaction.buyerIdentityId && transaction.buyerIdentityId !== identity.id) {
    throw new IdentityConflictError("This transaction is already associated with another buyer identity");
  }

  // Rate limit: at most 10 claim challenges per buyer identity per hour
  const windowStart = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.buyerClaimChallenge.count({
    where: { buyerIdentityId: identity.id, createdAt: { gte: windowStart } },
  });
  if (recent >= 10) {
    throw new IdentityRateLimitError("Too many claim attempts. Please try again later.");
  }

  const rawSecret = crypto.randomBytes(24).toString("hex");
  const tokenHash = hashSecret(rawSecret);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

  const challenge = await prisma.buyerClaimChallenge.create({
    data: {
      buyerIdentityId: identity.id,
      transactionId: transaction.id,
      tokenHash,
      expiresAt,
    },
  });

  await recordIdentityEvent(prisma, identity.id, BuyerIdentityEventType.CLAIM_CHALLENGE_ISSUED, {
    actorType: "BUYER",
    actorUserId: userId,
    metadata: { transactionId: transaction.id, challengeId: challenge.id },
  });

  return {
    challengeId: challenge.id,
    challengeToken: rawSecret,
    expiresAt,
  };
}

export async function claimTransactionWithChallenge(
  userId: string,
  input: { challengeId: string; challengeToken: string }
) {
  if (!userId || !input.challengeId || !input.challengeToken) {
    throw new BuyerIdentityError("Missing challenge credentials", "CHALLENGE_REQUIRED");
  }
  const identity = await getOrCreateBuyerIdentity(userId);

  const challenge = await prisma.buyerClaimChallenge.findFirst({
    where: { id: input.challengeId, buyerIdentityId: identity.id },
    include: { transaction: { include: { customer: true, order: true } } },
  });

  if (!challenge) {
    throw new VerificationChallengeError("Claim challenge not found");
  }
  if (challenge.consumedAt) {
    throw new VerificationChallengeError("Claim challenge already consumed");
  }
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw new VerificationChallengeError("Claim challenge has expired");
  }

  const submittedHash = hashSecret(input.challengeToken.trim());
  if (!safeEqualHex(submittedHash, challenge.tokenHash)) {
    await recordIdentityEvent(prisma, identity.id, BuyerIdentityEventType.CLAIM_REJECTED, {
      actorType: "BUYER",
      actorUserId: userId,
      metadata: { challengeId: challenge.id, reason: "INVALID_TOKEN" },
    });
    throw new VerificationChallengeError("Invalid claim token");
  }

  return prisma.$transaction(async (tx) => {
    const updatedChallenge = await tx.buyerClaimChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (updatedChallenge.count !== 1) {
      throw new VerificationChallengeError("Claim challenge already consumed");
    }

    return executeClaimTransaction(tx, identity.id, userId, challenge.transaction);
  });
}

export async function claimTransactionDirect(userId: string, trackingToken: string) {
  if (!userId || !trackingToken) {
    throw new BuyerIdentityError("User ID and tracking token required", "CLAIM_INPUT_REQUIRED");
  }
  const identity = await getOrCreateBuyerIdentity(userId);

  const transaction = await prisma.socialTransaction.findUnique({
    where: { publicTrackingToken: trackingToken },
    include: { customer: true, order: true },
  });

  if (!transaction) {
    throw new IdentityNotFoundError("Transaction not found");
  }

  if (transaction.buyerUserId && transaction.buyerUserId !== userId) {
    throw new IdentityConflictError("This transaction is already associated with another OrderFlow account");
  }
  if (transaction.buyerIdentityId && transaction.buyerIdentityId !== identity.id) {
    throw new IdentityConflictError("This transaction is already associated with another buyer identity");
  }

  return prisma.$transaction(async (tx) => {
    // Atomic check-and-set: update only where buyerUserId is null OR buyerUserId = userId
    const claimed = await tx.socialTransaction.updateMany({
      where: {
        id: transaction.id,
        OR: [
          { buyerUserId: null },
          { buyerUserId: userId },
        ],
      },
      data: {
        buyerUserId: userId,
        buyerIdentityId: identity.id,
      },
    });

    if (claimed.count !== 1) {
      throw new IdentityConflictError("This transaction is already associated with another OrderFlow account");
    }

    const currentTx = await tx.socialTransaction.findUnique({
      where: { id: transaction.id },
      include: { customer: true, order: true },
    });

    return executeClaimTransaction(tx, identity.id, userId, currentTx);
  });
}

async function executeClaimTransaction(
  tx: Prisma.TransactionClient,
  buyerIdentityId: string,
  userId: string,
  transaction: any
) {
  // 1. Link transaction to authenticated user and buyer identity
  const updated = await tx.socialTransaction.update({
    where: { id: transaction.id },
    data: {
      buyerUserId: userId,
      buyerIdentityId,
    },
  });

  // 2. Link Customer record if present and not conflicting
  if (transaction.customerId) {
    const existingForIdentity = await tx.customer.findUnique({
      where: {
        businessId_buyerIdentityId: {
          businessId: transaction.businessId,
          buyerIdentityId,
        },
      },
      select: { id: true },
    });
    if (!existingForIdentity) {
      await tx.customer.update({
        where: { id: transaction.customerId },
        data: { buyerIdentityId },
      });
    }
  }

  // 3. Link social account if transaction has social platform & externalUserId
  if (transaction.platform && transaction.externalUserId) {
    const providerMap: Record<string, BuyerIdentityProvider> = {
      INSTAGRAM: BuyerIdentityProvider.INSTAGRAM,
      WHATSAPP: BuyerIdentityProvider.WHATSAPP,
      FACEBOOK: BuyerIdentityProvider.FACEBOOK,
      X: BuyerIdentityProvider.X,
    };
    const provider = providerMap[transaction.platform];
    if (provider) {
      const normalized = normalizeExternalIdentity(provider, transaction.externalUserId);
      if (normalized) {
        const existingLink = await tx.buyerIdentityLink.findUnique({
          where: {
            provider_externalIdentityId: {
              provider,
              externalIdentityId: normalized,
            },
          },
        });
        if (!existingLink) {
          try {
            await tx.buyerIdentityLink.create({
              data: {
                buyerIdentityId,
                provider,
                externalIdentityId: normalized,
                normalizedIdentifier: normalized,
                confidence: IdentityConfidence.UNVERIFIED,
                verificationMethod: "TRANSACTION_CLAIMED",
              },
            });
          } catch (e) {
            // ignore unique violation if race condition
          }
        }
      }
    }
  }

  // 4. Audit trail
  await recordIdentityEvent(tx, buyerIdentityId, BuyerIdentityEventType.ACCOUNT_CLAIMED, {
    actorType: "BUYER",
    actorUserId: userId,
    metadata: {
      transactionId: transaction.id,
      publicTrackingToken: maskIdentifier(transaction.publicTrackingToken),
      businessId: transaction.businessId,
      platform: transaction.platform,
    },
  });

  // 5. Timeline event
  const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true } });
  await tx.transactionTimelineEvent.create({
    data: {
      transactionId: transaction.id,
      eventType: "TRANSACTION_CLAIMED",
      title: "Transaction Claimed to OrderFlow Account",
      description: `Associated with verified buyer account ${user?.email ?? "buyer"}`,
      actor: TimelineActor.BUYER,
      visibility: TimelineVisibility.INTERNAL_ONLY,
    },
  });

  // 6. Notification
  await tx.notification.create({
    data: {
      businessId: transaction.businessId,
      orderId: transaction.orderId,
      customerId: transaction.customerId,
      transactionId: transaction.id,
      userId,
      channel: "IN_APP",
      recipient: user?.email || "buyer@orderflow.internal",
      title: "Purchase Successfully Claimed",
      content: `Transaction for order #${transaction.order?.orderNumber || "N/A"} is now saved to your purchase dashboard.`,
      status: "SENT",
    },
  });

  return updated;
}

// ------------------------------------------------------------------
// Buyer profile & privacy
// ------------------------------------------------------------------

export interface UpdateBuyerProfileInput {
  displayName?: string | null;
  avatarUrl?: string | null;
  locale?: string | null;
  timezone?: string | null;
  privacySettings?: Record<string, unknown> | null;
  notificationPreferences?: Record<string, unknown> | null;
}

export async function getBuyerProfile(userId: string) {
  const identity = await getOrCreateBuyerIdentity(userId);

  const [links, unreadNotifications, purchaseCount] = await Promise.all([
    prisma.buyerIdentityLink.findMany({
      where: { buyerIdentityId: identity.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.notification.count({ where: { userId, readAt: null } }),
    prisma.socialTransaction.count({ where: { buyerIdentityId: identity.id } }),
  ]);

  return {
    buyerId: identity.id,
    status: identity.status,
    accountState: identity.accountState,
    displayName: identity.displayName,
    avatarUrl: identity.avatarUrl,
    locale: identity.locale,
    timezone: identity.timezone,
    email: identity.email,
    phone: identity.phone,
    emailVerified: Boolean(identity.emailVerifiedAt),
    phoneVerified: Boolean(identity.phoneVerifiedAt),
    verificationLevel: identity.verificationLevel,
    privacySettings: identity.privacySettings,
    notificationPreferences: identity.notificationPreferences,
    createdAt: identity.createdAt.toISOString(),
    lastSeenAt: identity.lastSeenAt?.toISOString() ?? null,
    purchaseCount,
    unreadNotifications,
    connectedIdentities: links.map((link) => ({
      linkId: link.id,
      provider: link.provider,
      confidence: link.confidence,
      verificationMethod: link.verificationMethod,
      displayValue: maskIdentifier(link.normalizedIdentifier ?? link.externalIdentityId),
      verifiedAt: link.verifiedAt?.toISOString() ?? null,
      lastVerifiedAt: link.lastVerifiedAt?.toISOString() ?? null,
      canUnlink: link.provider !== BuyerIdentityProvider.ORDERFLOW_ACCOUNT,
    })),
  };
}

export async function updateBuyerProfile(userId: string, input: UpdateBuyerProfileInput) {
  const identity = await getOrCreateBuyerIdentity(userId);

  const data: Prisma.BuyerIdentityUpdateInput = {};
  if (input.displayName !== undefined) {
    data.displayName = input.displayName ? input.displayName.trim().slice(0, 80) : null;
  }
  if (input.avatarUrl !== undefined) {
    data.avatarUrl = input.avatarUrl || null;
  }
  if (input.locale !== undefined) {
    data.locale = input.locale || null;
  }
  if (input.timezone !== undefined) {
    data.timezone = input.timezone || null;
  }
  if (input.privacySettings !== undefined) {
    data.privacySettings = input.privacySettings as Prisma.InputJsonValue;
  }
  if (input.notificationPreferences !== undefined) {
    data.notificationPreferences = input.notificationPreferences as Prisma.InputJsonValue;
  }

  const updated = await prisma.buyerIdentity.update({
    where: { id: identity.id },
    data,
  });

  await recordIdentityEvent(prisma, identity.id, BuyerIdentityEventType.IDENTITY_PROFILE_UPDATED, {
    actorType: "BUYER",
    actorUserId: userId,
    metadata: { fields: Object.keys(data) },
  });

  return updated;
}

export async function getBuyerPrivacySummary(userId: string) {
  const identity = await getOrCreateBuyerIdentity(userId);

  const [links, sellerLinks] = await Promise.all([
    prisma.buyerIdentityLink.findMany({
      where: { buyerIdentityId: identity.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.socialTransaction.findMany({
      where: { buyerIdentityId: identity.id },
      select: { business: { select: { name: true, slug: true } } },
      distinct: ["businessId"],
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    storedInformation: {
      profile: ["displayName", "avatarUrl", "locale", "timezone"],
      verifiedContacts: [
        ...(identity.emailVerifiedAt ? ["email"] : []),
        ...(identity.phoneVerifiedAt ? ["phone"] : []),
      ],
      note: "Unverified contact assertions are stored but never used to merge identities.",
    },
    connectedIdentities: links.map((link) => ({
      provider: link.provider,
      confidence: link.confidence,
      displayValue: maskIdentifier(link.normalizedIdentifier ?? link.externalIdentityId),
      verifiedAt: link.verifiedAt?.toISOString() ?? null,
    })),
    sellersWithPurchaseRecords: sellerLinks.map((row) => ({
      name: row.business.name,
      slug: row.business.slug,
    })),
    settings: identity.privacySettings,
    dataMinimization: {
      noAdvertisingProfiles: true,
      noCrossSellerBrowsingHistory: true,
      noProbabilisticIdentityMerging: true,
    },
    accountDeletion:
      "Contact support to delete your OrderFlow buyer identity. Closed accounts remove profile data; transaction records required for seller accounting are retained by the seller that issued them.",
  };
}

// ------------------------------------------------------------------
// Identity merge (explicit, proven, audited)
// ------------------------------------------------------------------

export async function createMergeRequest(
  userId: string,
  targetInput:
    | string
    | {
        targetIdentityId?: string;
        targetEmail?: string;
        targetPhone?: string;
        targetProvider?: BuyerIdentityProvider;
        targetExternalId?: string;
      },
  options?: { returnChallengeCodeForDelivery?: boolean }
) {
  const source = await getOrCreateBuyerIdentity(userId);

  let targetId: string | null = null;
  if (typeof targetInput === "string") {
    targetId = targetInput;
  } else if (targetInput.targetIdentityId) {
    targetId = targetInput.targetIdentityId;
  } else if (targetInput.targetEmail) {
    const normalized = normalizeEmail(targetInput.targetEmail);
    if (normalized) {
      const link = await prisma.buyerIdentityLink.findUnique({
        where: {
          provider_externalIdentityId: {
            provider: BuyerIdentityProvider.EMAIL,
            externalIdentityId: normalized,
          },
        },
      });
      if (link) {
        targetId = link.buyerIdentityId;
      } else {
        const idRow = await prisma.buyerIdentity.findFirst({
          where: { email: normalized, status: BuyerIdentityStatus.ACTIVE },
        });
        if (idRow) targetId = idRow.id;
      }
    }
  } else if (targetInput.targetPhone) {
    const normalized = normalizePhone(targetInput.targetPhone);
    if (normalized) {
      const link = await prisma.buyerIdentityLink.findUnique({
        where: {
          provider_externalIdentityId: {
            provider: BuyerIdentityProvider.PHONE,
            externalIdentityId: normalized,
          },
        },
      });
      if (link) {
        targetId = link.buyerIdentityId;
      } else {
        const idRow = await prisma.buyerIdentity.findFirst({
          where: { phone: normalized, status: BuyerIdentityStatus.ACTIVE },
        });
        if (idRow) targetId = idRow.id;
      }
    }
  } else if (targetInput.targetProvider && targetInput.targetExternalId) {
    const normalized = normalizeExternalIdentity(
      targetInput.targetProvider,
      targetInput.targetExternalId
    );
    if (normalized) {
      const link = await prisma.buyerIdentityLink.findUnique({
        where: {
          provider_externalIdentityId: {
            provider: targetInput.targetProvider,
            externalIdentityId: normalized,
          },
        },
      });
      if (link) targetId = link.buyerIdentityId;
    }
  }

  if (!targetId) {
    throw new IdentityNotFoundError("Identity to merge was not found");
  }

  if (source.id === targetId) {
    throw new BuyerIdentityError("Cannot merge an identity with itself", "SELF_MERGE");
  }

  const target = await prisma.buyerIdentity.findUnique({
    where: { id: targetId },
    include: {
      links: true,
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { customer: { select: { email: true, phone: true } } },
      },
    },
  });
  if (!target) throw new IdentityNotFoundError("Identity to merge was not found");
  if (target.mergedIntoId || target.status !== BuyerIdentityStatus.ACTIVE) {
    throw new BuyerIdentityError("That identity is no longer active", "IDENTITY_INACTIVE");
  }
  if (target.userId) {
    // Another OrderFlow account owns that identity: never take it over.
    throw new IdentityConflictError(
      "That identity belongs to another OrderFlow account. Sign in to that account to merge."
    );
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentRequests = await prisma.buyerIdentityMergeRequest.count({
    where: { sourceIdentityId: source.id, createdAt: { gte: since } },
  });
  if (recentRequests >= 3) throw new IdentityRateLimitError();

  const verifiedContact = target.links.find(
    (l) =>
      l.provider === BuyerIdentityProvider.EMAIL &&
      l.confidence !== IdentityConfidence.UNVERIFIED
  ) ?? target.links.find(
    (l) =>
      l.provider === BuyerIdentityProvider.PHONE &&
      l.confidence !== IdentityConfidence.UNVERIFIED
  );

  const fallbackCustomer = target.transactions[0]?.customer;

  const proofChannel = verifiedContact
    ? verifiedContact.provider
    : target.email
      ? BuyerIdentityProvider.EMAIL
      : target.phone
        ? BuyerIdentityProvider.PHONE
        : fallbackCustomer?.email
          ? BuyerIdentityProvider.EMAIL
          : fallbackCustomer?.phone
            ? BuyerIdentityProvider.PHONE
            : null;

  const proofTarget =
    verifiedContact?.externalIdentityId ??
    (proofChannel === BuyerIdentityProvider.EMAIL
      ? normalizeEmail(target.email ?? fallbackCustomer?.email)
      : proofChannel === BuyerIdentityProvider.PHONE
        ? normalizePhone(target.phone ?? fallbackCustomer?.phone)
        : null);

  if (!proofChannel || !proofTarget) {
    throw new BuyerIdentityError(
      "This identity has no verified contact point that can be proven. Ask the seller to add your verified email or phone to the transaction first.",
      "MERGE_PROOF_UNAVAILABLE",
      422
    );
  }

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.buyerIdentityMergeRequest.updateMany({
    where: { sourceIdentityId: source.id, status: "PENDING" },
    data: { status: "SUPERSEDED", decidedAt: new Date() },
  });

  const request = await prisma.buyerIdentityMergeRequest.create({
    data: {
      sourceIdentityId: source.id,
      targetIdentityId: target.id,
      requestedByUserId: userId,
      proofChannel,
      proofTarget,
      codeHash: hashSecret(code),
      expiresAt,
    },
  });

  const delivery = await deliverVerificationCode({
    buyerIdentityId: target.id,
    channel: proofChannel,
    target: proofTarget,
    code,
    purpose: BuyerVerificationPurpose.IDENTITY_MERGE,
  });

  await recordIdentityEvent(prisma, source.id, BuyerIdentityEventType.MERGE_REQUESTED, {
    actorType: "BUYER",
    actorUserId: userId,
    metadata: { targetIdentityId: target.id, proofChannel, delivered: delivery.delivered },
  });

  logger.info("buyer_identity.merge_requested", {
    action: "identity_merge_requested",
    buyerIdentityId: source.id,
    targetIdentityId: target.id,
    proofChannel,
    delivered: delivery.delivered,
  });

  return {
    requestId: request.id,
    expiresAt,
    proofChannel,
    delivered: delivery.delivered,
    deliveryAdapter: delivery.adapter,
    ...(options?.returnChallengeCodeForDelivery ? { code } : {}),
  };
}

export async function confirmIdentityMerge(
  userId: string,
  requestId: string,
  code: string
) {
  const source = await getOrCreateBuyerIdentity(userId);

  const request = await prisma.buyerIdentityMergeRequest.findUnique({
    where: { id: requestId },
    include: { targetIdentity: true },
  });
  if (!request || request.sourceIdentityId !== source.id) {
    throw new IdentityNotFoundError("Merge request not found");
  }
  if (request.status !== "PENDING") {
    throw new BuyerIdentityError("This merge request is no longer pending", "MERGE_NOT_PENDING", 409);
  }
  if (request.expiresAt.getTime() <= Date.now()) {
    await prisma.buyerIdentityMergeRequest.update({
      where: { id: request.id },
      data: { status: "EXPIRED", decidedAt: new Date() },
    });
    throw new BuyerIdentityError("This merge request has expired", "MERGE_EXPIRED", 410);
  }
  if (request.attempts >= request.maxAttempts) throw new IdentityRateLimitError();

  const submitted = hashSecret((code ?? "").trim());
  const valid = request.codeHash ? safeEqualHex(submitted, request.codeHash) : false;

  if (!valid) {
    const nextAttempts = request.attempts + 1;
    const exhausted = nextAttempts >= request.maxAttempts;
    await prisma.buyerIdentityMergeRequest.update({
      where: { id: request.id },
      data: {
        attempts: nextAttempts,
        ...(exhausted ? { status: "REJECTED", decidedAt: new Date() } : {}),
      },
    });
    if (exhausted) {
      await recordIdentityEvent(prisma, source.id, BuyerIdentityEventType.MERGE_REJECTED, {
        actorType: "BUYER",
        actorUserId: userId,
        metadata: { requestId: request.id },
      });
    }
    throw new VerificationChallengeError("Merge verification code is invalid");
  }

  const target = request.targetIdentity;
  if (target.mergedIntoId || target.status !== BuyerIdentityStatus.ACTIVE) {
    throw new BuyerIdentityError("That identity is no longer active", "IDENTITY_INACTIVE", 409);
  }

  let summary: { transactionsMoved: number; linksMoved: number; duplicateLinksCollapsed: number; customersRelinked: number };

  try {
    summary = await prisma.$transaction(
      async (tx) => {
        // Claim the target identity exactly once.
        const claimed = await tx.buyerIdentity.updateMany({
          where: {
            id: target.id,
            status: BuyerIdentityStatus.ACTIVE,
            mergedIntoId: null,
          },
          data: {
            status: BuyerIdentityStatus.MERGED,
            mergedIntoId: source.id,
            accountState: "MERGED",
          },
        });
        if (claimed.count !== 1) {
          throw new BuyerIdentityError(
            "This identity was merged or changed by another request",
            "MERGE_CONFLICT",
            409
          );
        }

        const transactionsMoved = await tx.socialTransaction.updateMany({
          where: { buyerIdentityId: target.id },
          data: { buyerIdentityId: source.id, buyerUserId: userId },
        });

        const [targetLinks, sourceLinks] = await Promise.all([
          tx.buyerIdentityLink.findMany({ where: { buyerIdentityId: target.id } }),
          tx.buyerIdentityLink.findMany({ where: { buyerIdentityId: source.id } }),
        ]);
        const sourceKey = new Set(
          sourceLinks.map((l) => `${l.provider}:${l.externalIdentityId}`)
        );

        let linksMoved = 0;
        let duplicateLinksCollapsed = 0;
        for (const link of targetLinks) {
          const key = `${link.provider}:${link.externalIdentityId}`;
          if (sourceKey.has(key)) {
            await tx.buyerIdentityLink.delete({ where: { id: link.id } });
            duplicateLinksCollapsed += 1;
          } else {
            await tx.buyerIdentityLink.update({
              where: { id: link.id },
              data: { buyerIdentityId: source.id },
            });
            sourceKey.add(key);
            linksMoved += 1;
          }
        }

        // Seller CRM records stay seller-scoped. When the surviving identity
        // already has a customer record in that tenant, the duplicate is
        // preserved but detached — seller data is never deleted by a merge.
        const targetCustomers = await tx.customer.findMany({
          where: { buyerIdentityId: target.id },
          select: { id: true, businessId: true },
        });
        let customersRelinked = 0;
        for (const customer of targetCustomers) {
          const conflicting = await tx.customer.findUnique({
            where: {
              businessId_buyerIdentityId: {
                businessId: customer.businessId,
                buyerIdentityId: source.id,
              },
            },
            select: { id: true },
          });
          if (conflicting) {
            await tx.customer.update({
              where: { id: customer.id },
              data: { buyerIdentityId: null },
            });
          } else {
            await tx.customer.update({
              where: { id: customer.id },
              data: { buyerIdentityId: source.id },
            });
            customersRelinked += 1;
          }
        }

        // Verified contacts proven on the target are promoted to the survivor.
        if (target.emailVerifiedAt && !source.emailVerifiedAt) {
          await tx.buyerIdentity.update({
            where: { id: source.id },
            data: { email: target.email, emailVerifiedAt: target.emailVerifiedAt },
          });
        }
        if (target.phoneVerifiedAt && !source.phoneVerifiedAt) {
          await tx.buyerIdentity.update({
            where: { id: source.id },
            data: { phone: target.phone, phoneVerifiedAt: target.phoneVerifiedAt },
          });
        }

        await recomputeVerificationLevel(source.id, tx);

        await tx.buyerIdentityMergeRequest.update({
          where: { id: request.id },
          data: { status: "MERGED", decidedAt: new Date() },
        });

        const metadata = {
          requestId: request.id,
          mergedIdentityId: target.id,
          transactionsMoved: transactionsMoved.count,
          linksMoved,
          duplicateLinksCollapsed,
          customersRelinked,
        };

        await recordIdentityEvent(tx, source.id, BuyerIdentityEventType.IDENTITY_MERGED, {
          actorType: "BUYER",
          actorUserId: userId,
          metadata,
        });
        await recordIdentityEvent(tx, target.id, BuyerIdentityEventType.IDENTITY_MERGED, {
          actorType: "SYSTEM",
          actorUserId: userId,
          metadata,
        });

        return {
          transactionsMoved: transactionsMoved.count,
          linksMoved,
          duplicateLinksCollapsed,
          customersRelinked,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
  } catch (error) {
    if (isSerializationFailure(error)) {
      throw new BuyerIdentityError(
        "Identity changed while merging. Please try again.",
        "MERGE_CONFLICT",
        409
      );
    }
    throw error;
  }

  logger.info("buyer_identity.merged", {
    action: "identity_merge_completed",
    buyerIdentityId: source.id,
    targetIdentityId: target.id,
    ...summary,
  });

  return { success: true as const, buyerId: source.id, summary };
}

// ------------------------------------------------------------------
// Seller-scoped customer resolution
// ------------------------------------------------------------------

/**
 * Resolves a buyer identity to a customer record *inside one tenant only*.
 * Matching rules are deterministic and require verified contact evidence;
 * names and handles are never used to merge customers.
 */
export async function resolveSellerCustomerForBuyer(input: {
  businessId: string;
  buyerIdentityId?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  instagramHandle?: string | null;
}) {
  const { businessId } = input;
  if (!businessId) throw new BuyerIdentityError("Business ID required", "BUSINESS_REQUIRED");

  if (input.buyerIdentityId) {
    const existing = await prisma.customer.findUnique({
      where: {
        businessId_buyerIdentityId: {
          businessId,
          buyerIdentityId: input.buyerIdentityId,
        },
      },
    });
    if (existing) {
      return { customer: existing, matchedBy: "IDENTITY" as const };
    }
  }

  let verifiedEmail: string | null = null;
  let verifiedPhone: string | null = null;

  if (input.buyerIdentityId) {
    const identity = await prisma.buyerIdentity.findUnique({
      where: { id: input.buyerIdentityId },
      include: { links: true },
    });
    if (!identity || identity.mergedIntoId) {
      throw new IdentityNotFoundError("Buyer identity not found");
    }
    verifiedEmail =
      identity.links.find(
        (l) =>
          l.provider === BuyerIdentityProvider.EMAIL &&
          l.confidence !== IdentityConfidence.UNVERIFIED
      )?.externalIdentityId ?? null;
    verifiedPhone =
      identity.links.find(
        (l) =>
          l.provider === BuyerIdentityProvider.PHONE &&
          l.confidence !== IdentityConfidence.UNVERIFIED
      )?.externalIdentityId ?? null;
  }

  // Deterministic contact match: exactly one candidate in this tenant.
  for (const matcher of [
    verifiedEmail ? { email: verifiedEmail } : null,
    verifiedPhone ? { phone: verifiedPhone } : null,
  ]) {
    if (!matcher) continue;
    const candidates = await prisma.customer.findMany({
      where: { businessId, ...matcher },
      take: 2,
    });
    if (candidates.length === 1) {
      const candidate = candidates[0];
      if (!candidate.buyerIdentityId && input.buyerIdentityId) {
        try {
          const linked = await prisma.customer.update({
            where: { id: candidate.id },
            data: { buyerIdentityId: input.buyerIdentityId },
          });
          return { customer: linked, matchedBy: "VERIFIED_CONTACT" as const };
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
        }
      } else if (!candidate.buyerIdentityId) {
        return { customer: candidate, matchedBy: "VERIFIED_CONTACT" as const };
      }
    }
  }

  const created = await prisma.customer.create({
    data: {
      businessId,
      buyerIdentityId: input.buyerIdentityId ?? null,
      name: (input.name ?? "OrderFlow Buyer").slice(0, 120),
      email: verifiedEmail ?? input.email ?? null,
      phone: verifiedPhone ?? input.phone ?? null,
      instagramHandle: input.instagramHandle ?? null,
    },
  });

  return { customer: created, matchedBy: "CREATED" as const };
}

export async function getBuyerIdentityByExternal(
  provider: BuyerIdentityProvider,
  externalIdentityId: string
) {
  const normalized = normalizeExternalIdentity(provider, externalIdentityId);
  if (!normalized) return null;
  return prisma.buyerIdentityLink.findUnique({
    where: { provider_externalIdentityId: { provider, externalIdentityId: normalized } },
    include: { buyerIdentity: true },
  });
}

/**
 * Seller-facing summary. Strictly limited to the caller's tenant.
 */
export async function getSellerBuyerLinkSummary(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    select: {
      id: true,
      buyerIdentityId: true,
      ordersCount: true,
      totalSpent: true,
      buyerIdentity: { select: { verificationLevel: true } },
    },
  });
  if (!customer) return null;
  return {
    customerId: customer.id,
    isOrderFlowBuyer: Boolean(customer.buyerIdentityId),
    verificationLevel: customer.buyerIdentity?.verificationLevel ?? null,
    ordersCount: customer.ordersCount,
    totalSpent: Number(customer.totalSpent),
  };
}

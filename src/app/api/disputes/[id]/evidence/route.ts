import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { checkRateLimit } from "@/lib/rate-limiter";
import { TimelineActor } from "@prisma/client";
import { submitDisputeEvidenceSchema } from "@/lib/validations";
import { submitDisputeEvidence, getDisputeById } from "@/lib/disputes";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const rate = checkRateLimit(req, { limit: 20, windowMs: 15 * 60 * 1000, keyPrefix: "dispute_evidence" });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many evidence submissions. Please try again later." },
        { status: 429, headers: rate.headers }
      );
    }

    const session = await getServerSession();
    const dispute = await getDisputeById(params.id);
    if (!dispute) {
      return NextResponse.json({ success: false, error: "Dispute not found" }, { status: 404, headers: rate.headers });
    }

    const body = await req.json();
    const validation = submitDisputeEvidenceSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.errors[0]?.message || "Invalid evidence data" },
        { status: 400, headers: rate.headers }
      );
    }

    const { trackingToken, ...evidencePayload } = validation.data;

    let isSellerMember = false;
    let isAuthorizedBuyer = false;

    if (session?.user?.id) {
      try {
        await assertBusinessAccess(session.user.id, dispute.businessId);
        isSellerMember = true;
      } catch {
        isSellerMember = false;
      }

      if (!isSellerMember && dispute.transaction?.buyerIdentity?.userId === session.user.id) {
        isAuthorizedBuyer = true;
      }
    }

    if (
      !isSellerMember &&
      !isAuthorizedBuyer &&
      trackingToken &&
      dispute.transaction?.publicTrackingToken === trackingToken
    ) {
      isAuthorizedBuyer = true;
    }

    if (!isSellerMember && !isAuthorizedBuyer) {
      const status = session?.user?.id || trackingToken ? 403 : 401;
      return NextResponse.json(
        { success: false, error: status === 401 ? "Authentication or tracking token required" : "Access denied" },
        { status, headers: rate.headers }
      );
    }

    // Enforce server-side actor attribution so neither side can spoof the other's role
    if (isSellerMember && evidencePayload.actor === "BUYER") {
      return NextResponse.json(
        { success: false, error: "Sellers cannot submit evidence under BUYER role" },
        { status: 403, headers: rate.headers }
      );
    }

    const normalizedActor: TimelineActor = isSellerMember
      ? (evidencePayload.actor as TimelineActor)
      : TimelineActor.BUYER;

    const result = await submitDisputeEvidence(
      params.id,
      {
        evidenceType: evidencePayload.evidenceType,
        mediaUrl: evidencePayload.mediaUrl ?? undefined,
        notes: evidencePayload.notes ?? undefined,
        metadata: evidencePayload.metadata ?? undefined,
        actor: normalizedActor,
        source: isSellerMember ? evidencePayload.source : "BUYER_PORTAL",
      },
      session?.user?.id
    );

    return NextResponse.json({ success: true, data: result }, { status: 201, headers: rate.headers });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to submit dispute evidence" },
      { status: 500 }
    );
  }
}

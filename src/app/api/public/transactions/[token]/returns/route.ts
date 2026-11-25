import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limiter";
import { publicCreateReturnRequestSchema } from "@/lib/validations";
import { createReturnRequest } from "@/lib/returns";
import { handleApiError, NotFoundError, ValidationError } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  try {
    const rate = checkRateLimit(req, {
      limit: 10,
      windowMs: 15 * 60 * 1000,
      keyPrefix: "public_return",
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many return submissions. Please try again later." },
        { status: 429, headers: rate.headers }
      );
    }

    const token = params.token;
    if (!token || token.length < 8) {
      throw new ValidationError("Invalid tracking token");
    }

    const transaction = await prisma.socialTransaction.findUnique({
      where: { publicTrackingToken: token },
      select: {
        id: true,
        businessId: true,
        orderId: true,
        buyerIdentityId: true,
      },
    });

    if (!transaction || !transaction.orderId) {
      throw new NotFoundError("Associated transaction or order not found");
    }

    const body = await req.json();
    const validation = publicCreateReturnRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: validation.error.errors[0]?.message || "Invalid return details",
          details: validation.error.flatten().fieldErrors,
        },
        { status: 400, headers: rate.headers }
      );
    }

    // Never trust client-supplied businessId or orderId; derive strictly from token
    const returnRequest = await createReturnRequest(
      transaction.businessId,
      {
        orderId: transaction.orderId,
        reason: validation.data.reason,
        buyerNotes: validation.data.buyerNotes,
        evidenceUrls: validation.data.evidenceUrls,
        items: validation.data.items,
      },
      {
        buyerIdentityId: transaction.buyerIdentityId,
        actorType: "BUYER",
      }
    );

    return NextResponse.json(
      { success: true, data: returnRequest },
      { status: 201, headers: rate.headers }
    );
  } catch (error) {
    return handleApiError(error, { action: "POST /api/public/transactions/[token]/returns" });
  }
}

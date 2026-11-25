import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { createTransactionReview, listPublishedReviews } from "@/lib/reviews";
import { createReviewSchema } from "@/lib/validations";
import { checkDistributedRateLimit } from "@/lib/rate-limiter";
import { handleApiError } from "@/lib/errors";
import { ReviewDisplayMode } from "@prisma/client";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId") || undefined;
    const productId = searchParams.get("productId") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "20", 10);

    const reviews = await listPublishedReviews({ businessId, productId, page, limit });
    return NextResponse.json({ success: true, data: reviews });
  } catch (error) {
    return handleApiError(error, { action: "GET /api/reviews" });
  }
}

export async function POST(req: NextRequest) {
  try {
    const rate = await checkDistributedRateLimit(req, {
      keyPrefix: "reviews-create",
      limit: 20,
      windowMs: 60_000,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Review submission rate limit exceeded" },
        { status: 429, headers: rate.headers }
      );
    }

    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: "Authentication required to submit a verified transaction review" },
        { status: 401, headers: rate.headers }
      );
    }

    const body = await req.json();
    const parsed = createReviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || "Invalid review input" },
        { status: 400, headers: rate.headers }
      );
    }

    const review = await createTransactionReview(session.user.id, {
      ...parsed.data,
      displayMode: parsed.data.displayMode as ReviewDisplayMode,
    });

    return NextResponse.json(
      { success: true, data: review },
      { status: 201, headers: rate.headers }
    );
  } catch (error) {
    return handleApiError(error, { action: "POST /api/reviews" });
  }
}

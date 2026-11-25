import { NextRequest, NextResponse } from "next/server";
import { PaymentProvider } from "@prisma/client";
import { processPaymentWebhook } from "@/lib/commerce-webhooks";
import { checkRateLimit } from "@/lib/rate-limiter";
import { handleApiError, ValidationError } from "@/lib/errors";

export async function POST(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  try {
    const rate = checkRateLimit(req, {
      limit: 120,
      windowMs: 60 * 1000,
      keyPrefix: `wh_pay_${params.provider}`,
    });
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many webhook requests" },
        { status: 429, headers: rate.headers }
      );
    }

    const providerKey = params.provider.toUpperCase() as PaymentProvider;
    if (!Object.values(PaymentProvider).includes(providerKey)) {
      throw new ValidationError(`Unsupported payment webhook provider: ${params.provider}`);
    }

    const rawBody = await req.text();
    const signature =
      req.headers.get("x-razorpay-signature") ||
      req.headers.get("stripe-signature") ||
      req.headers.get("x-webhook-signature") ||
      req.headers.get("x-hub-signature-256");

    const result = await processPaymentWebhook({
      provider: providerKey,
      rawBody,
      signature,
    });

    return NextResponse.json({ success: true, data: result }, { headers: rate.headers });
  } catch (error) {
    return handleApiError(error, { action: "POST /api/webhooks/payments/[provider]" });
  }
}

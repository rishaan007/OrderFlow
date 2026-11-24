import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import {
  requestContactVerification,
  verifyContactCode,
  BuyerIdentityError,
} from '@/lib/buyer-identity';
import {
  requestContactVerificationSchema,
  verifyContactCodeSchema,
} from '@/lib/validations';

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-identities-verify' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const body = await req.json();

    // Check if confirming a verification code
    if (body.challengeId || body.action === 'confirm') {
      const parsed = verifyContactCodeSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid verification input', details: parsed.error.format() },
          { status: 400, headers: rate.headers }
        );
      }

      const result = await verifyContactCode(session.user.id, {
        challengeId: parsed.data.challengeId,
        code: parsed.data.code,
      });

      return NextResponse.json(
        {
          success: true,
          message: 'Contact verified successfully',
          data: result,
        },
        { headers: rate.headers }
      );
    }

    // Otherwise, request a new verification challenge
    const parsed = requestContactVerificationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid verification request', details: parsed.error.format() },
        { status: 400, headers: rate.headers }
      );
    }

    const challenge = await requestContactVerification(session.user.id, {
      type: parsed.data.type,
      value: parsed.data.value,
    });

    return NextResponse.json(
      {
        success: true,
        message: challenge.delivered
          ? 'Verification code sent'
          : 'Verification challenge created (delivery pending or adapter not configured)',
        data: {
          challengeId: challenge.challengeId,
          expiresAt: challenge.expiresAt,
          delivered: challenge.delivered,
        },
      },
      { status: 201, headers: rate.headers }
    );
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Verification operation failed', code: error.code || 'VERIFICATION_ERROR' },
      { status, headers: rate.headers }
    );
  }
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import {
  claimTransactionDirect,
  createClaimChallenge,
  claimTransactionWithChallenge,
  BuyerIdentityError,
} from '@/lib/buyer-identity';
import {
  claimTransactionSchema,
  createBuyerClaimChallengeSchema,
  consumeBuyerClaimChallengeSchema,
} from '@/lib/validations';

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-claims' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const body = await req.json();

    // 1. Two-step challenge consumption
    if (body.challengeId && body.challengeToken) {
      const parsed = consumeBuyerClaimChallengeSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid challenge credentials', details: parsed.error.format() },
          { status: 400, headers: rate.headers }
        );
      }

      const result = await claimTransactionWithChallenge(session.user.id, {
        challengeId: parsed.data.challengeId,
        challengeToken: parsed.data.challengeToken,
      });

      return NextResponse.json(
        {
          success: true,
          message: 'Transaction claimed successfully via verified challenge',
          data: result,
        },
        { headers: rate.headers }
      );
    }

    // 2. Request a challenge token
    if (body.action === 'request_challenge') {
      const parsed = createBuyerClaimChallengeSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid challenge request', details: parsed.error.format() },
          { status: 400, headers: rate.headers }
        );
      }

      const challenge = await createClaimChallenge(session.user.id, parsed.data.token);
      return NextResponse.json(
        {
          success: true,
          message: 'Claim challenge created',
          data: challenge,
        },
        { status: 201, headers: rate.headers }
      );
    }

    // 3. Direct transaction claiming
    const parsed = claimTransactionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid claim input', details: parsed.error.format() },
        { status: 400, headers: rate.headers }
      );
    }

    const result = await claimTransactionDirect(session.user.id, parsed.data.token);
    return NextResponse.json(
      {
        success: true,
        message: 'Transaction successfully claimed to your OrderFlow buyer identity',
        data: result,
      },
      { headers: rate.headers }
    );
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to claim transaction', code: error.code || 'CLAIM_FAILED' },
      { status, headers: rate.headers }
    );
  }
}

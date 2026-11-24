import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { createMergeRequest, BuyerIdentityError } from '@/lib/buyer-identity';
import { createMergeRequestSchema } from '@/lib/validations';
import { BuyerIdentityProvider } from '@prisma/client';

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-merge-request' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const body = await req.json();
    const parsed = createMergeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid merge request parameters', details: parsed.error.format() },
        { status: 400, headers: rate.headers }
      );
    }

    const { targetIdentityId, targetEmail, targetPhone, targetProvider, targetExternalId } = parsed.data;

    const targetInput = targetIdentityId
      ? targetIdentityId
      : {
          targetEmail,
          targetPhone,
          targetProvider: targetProvider as BuyerIdentityProvider | undefined,
          targetExternalId,
        };

    const result = await createMergeRequest(session.user.id, targetInput);

    return NextResponse.json(
      {
        success: true,
        message: result.delivered
          ? 'Merge verification code sent to the contact address of the target identity'
          : 'Merge challenge created (delivery pending or adapter not configured)',
        data: {
          requestId: result.requestId,
          expiresAt: result.expiresAt,
          proofChannel: result.proofChannel,
          delivered: result.delivered,
        },
      },
      { status: 201, headers: rate.headers }
    );
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to initiate identity merge', code: error.code || 'MERGE_FAILED' },
      { status, headers: rate.headers }
    );
  }
}

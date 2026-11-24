import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { linkBuyerIdentity, BuyerIdentityError } from '@/lib/buyer-identity';
import { linkBuyerIdentitySchema } from '@/lib/validations';
import { BuyerIdentityProvider } from '@prisma/client';

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-identities-link' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const body = await req.json();
    const parsed = linkBuyerIdentitySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid identity data', details: parsed.error.format() },
        { status: 400, headers: rate.headers }
      );
    }

    const result = await linkBuyerIdentity(session.user.id, {
      provider: parsed.data.provider as BuyerIdentityProvider,
      externalIdentityId: parsed.data.externalIdentityId,
      metadata: (parsed.data.metadata ?? undefined) as Record<string, unknown> | undefined,
    });

    return NextResponse.json(
      {
        success: true,
        message: result.alreadyLinked ? 'Identity already connected' : 'Identity connected successfully',
        data: {
          id: result.link.id,
          provider: result.link.provider,
          confidence: result.link.confidence,
          alreadyLinked: result.alreadyLinked,
        },
      },
      { status: result.alreadyLinked ? 200 : 201, headers: rate.headers }
    );
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to link identity', code: error.code || 'IDENTITY_LINK_FAILED' },
      { status, headers: rate.headers }
    );
  }
}

import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { getOrCreateBuyerIdentity, maskIdentifier, BuyerIdentityError } from '@/lib/buyer-identity';
import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-identities-get' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const identity = await getOrCreateBuyerIdentity(session.user.id);

    const links = await prisma.buyerIdentityLink.findMany({
      where: { buyerIdentityId: identity.id },
      orderBy: { createdAt: 'asc' },
    });

    const sanitizedLinks = links.map((link) => ({
      id: link.id,
      provider: link.provider,
      confidence: link.confidence,
      verificationMethod: link.verificationMethod,
      displayValue: maskIdentifier(link.normalizedIdentifier ?? link.externalIdentityId),
      verifiedAt: link.verifiedAt?.toISOString() ?? null,
      lastVerifiedAt: link.lastVerifiedAt?.toISOString() ?? null,
      canUnlink: link.provider !== 'ORDERFLOW_ACCOUNT',
      createdAt: link.createdAt.toISOString(),
    }));

    return NextResponse.json(
      {
        success: true,
        data: {
          buyerId: identity.id,
          verificationLevel: identity.verificationLevel,
          identities: sanitizedLinks,
        },
      },
      { headers: rate.headers }
    );
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve connected identities' },
      { status, headers: rate.headers }
    );
  }
}

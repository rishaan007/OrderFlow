import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { unlinkBuyerIdentity, BuyerIdentityError } from '@/lib/buyer-identity';

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const linkId = params?.id;
  if (!linkId) {
    return NextResponse.json({ error: 'Identity link ID required' }, { status: 400 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-identities-unlink' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const result = await unlinkBuyerIdentity(session.user.id, linkId);
    return NextResponse.json(
      { success: true, message: 'Identity unlinked successfully', data: result },
      { headers: rate.headers }
    );
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to unlink identity', code: error.code || 'UNLINK_FAILED' },
      { status, headers: rate.headers }
    );
  }
}

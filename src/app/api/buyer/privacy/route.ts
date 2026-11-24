import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import {
  getBuyerPrivacySummary,
  updateBuyerProfile,
  BuyerIdentityError,
} from '@/lib/buyer-identity';

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-privacy-get' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const summary = await getBuyerPrivacySummary(session.user.id);
    return NextResponse.json({ success: true, data: summary }, { headers: rate.headers });
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve privacy summary' },
      { status, headers: rate.headers }
    );
  }
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-privacy-patch' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const body = await req.json();
    const privacySettings = body?.privacySettings;

    if (!privacySettings || typeof privacySettings !== 'object') {
      return NextResponse.json(
        { error: 'Invalid privacy settings object' },
        { status: 400, headers: rate.headers }
      );
    }

    const updated = await updateBuyerProfile(session.user.id, {
      privacySettings,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Privacy settings updated successfully',
        data: updated.privacySettings,
      },
      { headers: rate.headers }
    );
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to update privacy settings' },
      { status, headers: rate.headers }
    );
  }
}

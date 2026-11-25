import { NextResponse } from 'next/server';
import { PrivacyVisibility, ReviewDisplayMode } from '@prisma/client';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import {
  getBuyerPrivacySummary,
  updateBuyerProfile,
  BuyerIdentityError,
} from '@/lib/buyer-identity';
import { deactivateOrDeleteBuyerIdentity } from '@/lib/export-portability';

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
    const networkVisibility = body?.networkVisibility as PrivacyVisibility | undefined;
    const reviewDisplayMode = body?.reviewDisplayMode as ReviewDisplayMode | undefined;

    if (
      networkVisibility !== undefined &&
      !Object.values(PrivacyVisibility).includes(networkVisibility)
    ) {
      return NextResponse.json(
        { error: 'Invalid networkVisibility setting' },
        { status: 400, headers: rate.headers }
      );
    }

    if (
      reviewDisplayMode !== undefined &&
      !Object.values(ReviewDisplayMode).includes(reviewDisplayMode)
    ) {
      return NextResponse.json(
        { error: 'Invalid reviewDisplayMode setting' },
        { status: 400, headers: rate.headers }
      );
    }

    if (
      !privacySettings &&
      networkVisibility === undefined &&
      reviewDisplayMode === undefined
    ) {
      return NextResponse.json(
        { error: 'No privacy update fields supplied' },
        { status: 400, headers: rate.headers }
      );
    }

    const updated = await updateBuyerProfile(session.user.id, {
      ...(privacySettings && typeof privacySettings === 'object' ? { privacySettings } : {}),
      ...(networkVisibility !== undefined ? { networkVisibility } : {}),
      ...(reviewDisplayMode !== undefined ? { reviewDisplayMode } : {}),
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Privacy settings updated successfully',
        data: {
          privacySettings: updated.privacySettings,
          networkVisibility: updated.networkVisibility,
          reviewDisplayMode: updated.reviewDisplayMode,
        },
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

export async function DELETE(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-privacy-delete', limit: 5 });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode === 'DELETE' ? 'DELETE' : 'DEACTIVATE';
    const result = await deactivateOrDeleteBuyerIdentity(
      session.user.id,
      mode,
      body?.reason
    );
    return NextResponse.json(
      { success: true, data: result },
      { headers: rate.headers }
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to process account lifecycle change' },
      { status: 400, headers: rate.headers }
    );
  }
}

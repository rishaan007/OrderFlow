import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { getBuyerProfile, updateBuyerProfile, BuyerIdentityError } from '@/lib/buyer-identity';
import { updateBuyerProfileSchema } from '@/lib/validations';

export async function GET(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-profile-get' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const profile = await getBuyerProfile(session.user.id);
    return NextResponse.json({ success: true, data: profile }, { headers: rate.headers });
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve buyer profile' },
      { status, headers: rate.headers }
    );
  }
}

export async function PATCH(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-profile-patch' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const body = await req.json();
    const parsed = updateBuyerProfileSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid profile data', details: parsed.error.format() },
        { status: 400, headers: rate.headers }
      );
    }

    const updated = await updateBuyerProfile(session.user.id, parsed.data);
    return NextResponse.json(
      { success: true, message: 'Profile updated successfully', data: updated },
      { headers: rate.headers }
    );
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to update profile' },
      { status, headers: rate.headers }
    );
  }
}

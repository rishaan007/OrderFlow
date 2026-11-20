import { NextResponse } from 'next/server';
import { getBuyerNotifications } from '@/lib/buyer';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const rate = checkRateLimit(req, { keyPrefix: 'buyer-notifications' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }
  try {
    const notifications = await getBuyerNotifications(session.user.id);
    return NextResponse.json({ success: true, data: notifications }, { headers: rate.headers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500, headers: rate.headers });
  }
}

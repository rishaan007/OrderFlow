import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { markBuyerNotificationAsRead } from '@/lib/buyer';
import { checkRateLimit } from '@/lib/rate-limiter';

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-notification-mark' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  const { id } = (req as any).params ?? {};
  if (!id) {
    return NextResponse.json({ error: 'Missing notification ID' }, { status: 400, headers: rate.headers });
  }

  try {
    const result = await markBuyerNotificationAsRead(id, session.user.id);
    return NextResponse.json({ success: true, data: result }, { headers: rate.headers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500, headers: rate.headers });
  }
}

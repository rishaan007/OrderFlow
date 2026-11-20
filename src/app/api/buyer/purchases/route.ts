import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getBuyerPurchases } from '@/lib/buyer';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const url = new URL(req.url);
  const filter = url.searchParams.get('filter') as any;

  try {
    const purchases = await getBuyerPurchases(session.user.id, filter);
    return NextResponse.json({ success: true, data: purchases });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 });
  }
}

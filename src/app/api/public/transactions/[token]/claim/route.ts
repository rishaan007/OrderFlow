// src/app/api/public/transactions/[token]/claim/route.ts
import { NextResponse } from 'next/server';
import { claimGuestTransaction } from '@/lib/buyer';
import { claimTransactionSchema } from '@/lib/validations';
import { getServerSession } from '@/lib/auth';

export async function POST(req: Request, { params }: { params: { token: string } }) {
  // Claiming a transaction requires an authenticated user
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = claimTransactionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.format() }, { status: 400 });
  }

  const token = params?.token;
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  try {
    const result = await claimGuestTransaction(session.user.id, token);
    return NextResponse.json(result);
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500 });
  }
}

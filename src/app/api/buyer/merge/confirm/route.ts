import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limiter';
import { confirmIdentityMerge, BuyerIdentityError } from '@/lib/buyer-identity';
import { confirmMergeRequestSchema } from '@/lib/validations';

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const rate = checkRateLimit(req, { keyPrefix: 'buyer-merge-confirm' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }

  try {
    const body = await req.json();
    const parsed = confirmMergeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid confirmation input', details: parsed.error.format() },
        { status: 400, headers: rate.headers }
      );
    }

    const result = await confirmIdentityMerge(
      session.user.id,
      parsed.data.requestId,
      parsed.data.code
    );

    return NextResponse.json(
      {
        success: true,
        message: 'Identities successfully merged into your active OrderFlow identity',
        data: result,
      },
      { headers: rate.headers }
    );
  } catch (error: any) {
    const status = error instanceof BuyerIdentityError ? error.status : 500;
    return NextResponse.json(
      { error: error.message || 'Failed to confirm merge', code: error.code || 'CONFIRM_MERGE_FAILED' },
      { status, headers: rate.headers }
    );
  }
}

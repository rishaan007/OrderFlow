// src/app/api/public/transactions/[token]/confirm-delivery/route.ts
import { NextResponse } from 'next/server';
import { confirmDeliveryInformation } from '@/lib/buyer';
import { confirmDeliverySchema } from '@/lib/validations';
import { checkRateLimit } from '@/lib/rate-limiter';

export async function POST(
  req: Request,
  { params }: { params: { token: string } }
) {
  const rate = checkRateLimit(req, { keyPrefix: 'public-delivery' });
  if (!rate.allowed) {
    return new Response('Too Many Requests', { status: 429, headers: rate.headers });
  }
  // Guest delivery confirmation does not require auth; token comes from Next.js params
  const body = await req.json();
  const parsed = confirmDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.format() }, { status: 400, headers: rate.headers });
  }
  const token = params?.token;
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400, headers: rate.headers });
  }
  try {
    const result = await confirmDeliveryInformation(token, parsed.data);
    return NextResponse.json(result, { headers: rate.headers });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message || 'Server error' }, { status: 500, headers: rate.headers });
  }
}

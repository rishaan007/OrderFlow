import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { confirmDraftTransaction } from "@/lib/draft-transactions";
import { z } from "zod";

const confirmSchema = z.object({
  customerName: z.string().optional(),
  shippingAddress: z.string().optional(),
  city: z.string().optional(),
  customerPhone: z.string().optional(),
  customerEmail: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
  allowDuplicate: z.boolean().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    await assertBusinessAccess(session.user.id, businessId);

    const body = await request.json().catch(() => ({}));
    const validated = confirmSchema.parse(body);

    const result = await confirmDraftTransaction(businessId, params.id, {
      ...validated,
      customerEmail: validated.customerEmail || undefined,
    });

    return NextResponse.json({
      success: true,
      data: result,
      message: `Order #${result.order.orderNumber} successfully confirmed from draft transaction`,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to confirm draft transaction" },
      { status: 400 }
    );
  }
}

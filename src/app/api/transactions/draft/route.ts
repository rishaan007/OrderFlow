import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { assertBusinessAccess } from "@/lib/tenant";
import { createDraftTransaction } from "@/lib/draft-transactions";
import { z } from "zod";

const draftSchema = z.object({
  conversationId: z.string().min(1, "conversationId is required"),
  customerId: z.string().optional().nullable(),
  customerName: z.string().min(1, "customerName is required"),
  customerPhone: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().nullable().or(z.literal("")),
  shippingAddress: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  items: z.array(
    z.object({
      productId: z.string().optional().nullable(),
      variantId: z.string().optional().nullable(),
      title: z.string().min(1, "Item title is required"),
      variantTitle: z.string().optional().nullable(),
      sku: z.string().optional().nullable(),
      quantity: z.number().int().min(1),
      unitPrice: z.number().min(0),
    })
  ).min(1, "At least one item is required in the draft transaction"),
  discount: z.number().min(0).optional(),
  shipping: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
  platform: z.enum(["INSTAGRAM", "WHATSAPP", "FACEBOOK", "X", "MANUAL", "OTHER"]).optional(),
  surface: z.enum([
    "DM",
    "STORY",
    "REEL",
    "POST",
    "DIRECT_CHAT",
    "BUSINESS_PROFILE",
    "CATALOG",
    "MESSENGER",
    "MARKETPLACE",
    "PAGE",
    "SHOP",
    "X_DM",
    "TWEET",
    "MANUAL_ENTRY",
    "EXTERNAL_LINK",
    "OTHER",
  ]).optional(),
  externalDetails: z.object({
    externalUserId: z.string().optional(),
    externalConversationId: z.string().optional(),
    externalMessageId: z.string().optional(),
    externalProductId: z.string().optional(),
    externalListingId: z.string().optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const validated = draftSchema.parse(body);

    const draft = await createDraftTransaction({
      businessId,
      ...validated,
      customerEmail: validated.customerEmail || undefined,
      platform: validated.platform as any,
      surface: validated.surface as any,
    });

    return NextResponse.json(
      {
        success: true,
        data: draft,
        message: "Draft transaction created successfully from conversation",
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error.name === "ZodError") {
      return NextResponse.json(
        { success: false, error: error.errors[0]?.message || "Validation failed" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: error.message || "Failed to create draft transaction" },
      { status: 500 }
    );
  }
}

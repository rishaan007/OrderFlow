import { NextRequest, NextResponse } from "next/server";
import { getServerSession, BUSINESS_COOKIE_NAME } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { businessOnboardingSchema } from "@/lib/validations";
import { ApiResponse } from "@/types";
import { MemberRole } from "@prisma/client";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session?.user) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    const body = await req.json();
    const parseResult = businessOnboardingSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: parseResult.error.errors[0]?.message || "Invalid input data",
          details: parseResult.error.flatten(),
        },
        { status: 400 }
      );
    }

    const {
      name,
      slug,
      currency,
      timezone,
      phone,
      email,
      address,
      instagramHandle,
      whatsappNumber,
    } = parseResult.data;

    // Check slug availability
    let finalSlug = slug;
    const existingBusiness = await prisma.business.findUnique({
      where: { slug: finalSlug },
    });

    if (existingBusiness) {
      // Append unique random suffix
      finalSlug = `${slug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    // Atomically create business, membership, profile, and initial audit log
    const result = await prisma.$transaction(async (tx) => {
      const business = await tx.business.create({
        data: {
          name,
          slug: finalSlug,
          currency: currency || "USD",
          timezone: timezone || "UTC",
          phone: phone || null,
          email: email || null,
          address: address || null,
        },
      });

      await tx.businessMember.create({
        data: {
          businessId: business.id,
          userId: session.user.id,
          role: MemberRole.OWNER,
        },
      });

      const profile = await tx.businessProfile.create({
        data: {
          businessId: business.id,
          instagramHandle: instagramHandle || null,
          whatsappNumber: whatsappNumber || null,
          orderPrefix: "ORD-",
          autoConfirmOrders: false, // Per strict master instructions!
        },
      });

      await tx.auditLog.create({
        data: {
          businessId: business.id,
          userId: session.user.id,
          action: "BUSINESS_CREATED",
          entityType: "Business",
          entityId: business.id,
          metadata: { name: business.name, slug: business.slug },
        },
      });

      return { business, profile };
    });

    const response = NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          business: result.business,
          profile: result.profile,
          message: "Business onboarded successfully",
        },
      },
      { status: 201 }
    );

    // Set active business cookie
    response.cookies.set(BUSINESS_COOKIE_NAME, result.business.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

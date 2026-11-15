import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  verifyPassword,
  signSessionToken,
  SESSION_COOKIE_NAME,
  BUSINESS_COOKIE_NAME,
} from "@/lib/auth";
import { loginSchema } from "@/lib/validations";
import { ApiResponse } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parseResult = loginSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: parseResult.error.errors[0]?.message || "Invalid credentials",
        },
        { status: 400 }
      );
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        businessMembers: {
          include: {
            business: true,
          },
        },
      },
    });

    if (!user || !user.passwordHash) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const defaultBusiness = user.businessMembers[0]?.business;
    const token = signSessionToken({
      userId: user.id,
      email: user.email,
      systemRole: user.systemRole,
      activeBusinessId: defaultBusiness?.id,
    });

    const response = NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            systemRole: user.systemRole,
          },
          hasBusiness: Boolean(defaultBusiness),
          redirectTo: defaultBusiness ? "/dashboard" : "/onboarding",
        },
      },
      { status: 200 }
    );

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });

    if (defaultBusiness) {
      response.cookies.set(BUSINESS_COOKIE_NAME, defaultBusiness.id, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }

    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, signSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { registerSchema } from "@/lib/validations";
import { ApiResponse } from "@/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parseResult = registerSchema.safeParse(body);

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

    const { name, email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existing = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (existing) {
      return NextResponse.json<ApiResponse>(
        {
          success: false,
          error: "An account with this email address already exists",
        },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        name,
        email: normalizedEmail,
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        email: true,
        systemRole: true,
      },
    });

    const token = signSessionToken({
      userId: user.id,
      email: user.email,
      systemRole: user.systemRole,
    });

    const response = NextResponse.json<ApiResponse>(
      {
        success: true,
        data: {
          user,
          requiresOnboarding: true,
        },
      },
      { status: 201 }
    );

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
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

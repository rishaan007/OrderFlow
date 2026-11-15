import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth";
import { ApiResponse, AuthSession } from "@/types";

export async function GET() {
  try {
    const session = await getServerSession();

    if (!session) {
      return NextResponse.json<ApiResponse>(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    return NextResponse.json<ApiResponse<AuthSession>>(
      {
        success: true,
        data: session,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json<ApiResponse>(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

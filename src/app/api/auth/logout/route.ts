import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, BUSINESS_COOKIE_NAME } from "@/lib/auth";
import { ApiResponse } from "@/types";

export async function POST() {
  const response = NextResponse.json<ApiResponse>(
    {
      success: true,
      data: { message: "Successfully logged out" },
    },
    { status: 200 }
  );

  response.cookies.delete(SESSION_COOKIE_NAME);
  response.cookies.delete(BUSINESS_COOKIE_NAME);

  return response;
}

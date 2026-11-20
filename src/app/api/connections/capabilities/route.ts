import { NextResponse } from "next/server";
import { getPlatformsCapabilityMatrix } from "@/lib/providers/registry";

export async function GET() {
  const capabilities = getPlatformsCapabilityMatrix();
  return NextResponse.json({
    success: true,
    data: capabilities,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { getServerSession, signToken } from "@/lib/auth";
import { getSocialProvider } from "@/lib/providers/registry";
import { SocialPlatform } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: { platform: string } }
) {
  try {
    const session = await getServerSession();
    if (!session?.user || !session.activeBusiness?.businessId) {
      return NextResponse.redirect(new URL("/login", request.url));
    }

    const platformKey = params.platform.toUpperCase() as SocialPlatform;
    if (!Object.values(SocialPlatform).includes(platformKey)) {
      return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
    }

    const provider = getSocialProvider(platformKey);
    if (!provider.getAuthorizationUrl) {
      return NextResponse.json(
        { error: `${platformKey} does not support automated OAuth flow` },
        { status: 400 }
      );
    }

    const businessId = session.activeBusiness.businessId;
    const userId = session.user.id;

    // Secure state token to prevent CSRF
    const state = signToken({
      businessId,
      userId,
      platform: platformKey,
      nonce: Math.random().toString(36).substring(2),
      timestamp: Date.now(),
    });

    const redirectUri = `${new URL(request.url).origin}/api/auth/oauth/${params.platform.toLowerCase()}/callback`;
    const authUrl = provider.getAuthorizationUrl(state, redirectUri);

    return NextResponse.redirect(authUrl);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "OAuth initialization failed" },
      { status: 500 }
    );
  }
}

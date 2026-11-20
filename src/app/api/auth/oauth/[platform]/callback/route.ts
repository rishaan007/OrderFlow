import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getSocialProvider } from "@/lib/providers/registry";
import { createOrUpdateConnection } from "@/lib/connections";
import { SocialPlatform } from "@prisma/client";

export async function GET(
  request: NextRequest,
  { params }: { params: { platform: string } }
) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const baseUrl = new URL(request.url).origin;
  const redirectTarget = `${baseUrl}/settings/integrations`;

  if (oauthError) {
    return NextResponse.redirect(
      `${redirectTarget}?error=${encodeURIComponent(
        errorDescription || oauthError
      )}`
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      `${redirectTarget}?error=${encodeURIComponent(
        "Missing authorization code or state token"
      )}`
    );
  }

  try {
    const verified = verifyToken(state) as any;
    if (!verified || !verified.businessId || !verified.platform) {
      return NextResponse.redirect(
        `${redirectTarget}?error=${encodeURIComponent(
          "Invalid or expired OAuth state parameter (CSRF protection failed)"
        )}`
      );
    }

    // Check expiration (max 15 mins)
    if (Date.now() - verified.timestamp > 15 * 60 * 1000) {
      return NextResponse.redirect(
        `${redirectTarget}?error=${encodeURIComponent(
          "OAuth authorization expired. Please try connecting again."
        )}`
      );
    }

    const platformKey = verified.platform as SocialPlatform;
    const provider = getSocialProvider(platformKey);

    const redirectUri = `${baseUrl}/api/auth/oauth/${params.platform.toLowerCase()}/callback`;

    if (!provider.exchangeCodeForTokens) {
      return NextResponse.redirect(
        `${redirectTarget}?error=${encodeURIComponent(
          "Provider does not support automated token exchange"
        )}`
      );
    }

    const tokenSet = await provider.exchangeCodeForTokens(code, redirectUri);

    // Fetch account info if provider supports it
    let accountIdentifier = tokenSet.accountIdentifier || `acct_${Date.now()}`;
    let accountName = tokenSet.accountName || `${platformKey} Account`;
    let avatarUrl: string | undefined;

    if (provider.getAccountInfo && tokenSet.accessToken) {
      const info = await provider.getAccountInfo(tokenSet.accessToken).catch(() => null);
      if (info) {
        accountIdentifier = info.username || info.id || accountIdentifier;
        accountName = info.name || accountName;
        avatarUrl = info.avatarUrl;
      }
    }

    await createOrUpdateConnection(verified.businessId, {
      platform: platformKey,
      accountIdentifier,
      accountName,
      avatarUrl,
      accessToken: tokenSet.accessToken,
      refreshToken: tokenSet.refreshToken,
      tokenExpiresAt: tokenSet.expiresAt,
    });

    return NextResponse.redirect(
      `${redirectTarget}?connected=${platformKey.toLowerCase()}`
    );
  } catch (err: any) {
    console.error("OAuth callback error:", err);
    return NextResponse.redirect(
      `${redirectTarget}?error=${encodeURIComponent(
        err.message || "Failed to complete platform authorization"
      )}`
    );
  }
}

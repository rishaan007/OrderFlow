import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function isTokenExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const payload = JSON.parse(jsonPayload);
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const sessionToken = request.cookies.get("orderflow_session")?.value;

  const isProtectedPage =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/orders") ||
    pathname.startsWith("/customers") ||
    pathname.startsWith("/products") ||
    pathname.startsWith("/inbox") ||
    pathname.startsWith("/onboarding");

  // Check if session token exists and is not expired
  const hasValidToken = Boolean(sessionToken && !isTokenExpired(sessionToken));

  // If user is accessing a protected page without a valid session
  if (isProtectedPage && !hasValidToken) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    if (sessionToken) {
      // Clear stale/expired token
      response.cookies.delete("orderflow_session");
      response.cookies.delete("orderflow_active_business");
    }
    return response;
  }

  // Root landing page: if authenticated, redirect to /dashboard
  if (pathname === "/" && hasValidToken) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|images|api/auth).*)",
  ],
};

import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "asee_session";
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/company",
  "/products",
  "/sales",
  "/users",
];

/**
 * UX-only redirect: if there's no session cookie and the request targets a
 * protected route, bounce to /login. The backend is the real authority on
 * every request; this just avoids flashing an authenticated shell at
 * logged-out visitors.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

  if (!isProtected) return NextResponse.next();

  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/company/:path*", "/products/:path*", "/sales/:path*", "/users/:path*"],
};

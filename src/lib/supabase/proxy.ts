import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Pages a signed-out visitor may open.
const PUBLIC_PATHS = ["/login"];

// Refreshes the Supabase auth session and writes updated cookies to the response.
// Also sends signed-out visitors to /login, and signed-in ones away from it.
// This is an optimistic check only: pages and Server Functions must still call
// requireUser() from src/lib/auth.ts.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // No-cache headers Supabase asks for when it refreshes the session.
  let authHeaders: Record<string, string> = {};

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  // Supabase not configured yet (no .env.local): let the request through.
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        authHeaders = headers;
        Object.entries(headers).forEach(([header, value]) =>
          response.headers.set(header, value),
        );
      },
    },
  });

  // Do not put code between createServerClient and getClaims():
  // getClaims() is what refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const { pathname, search } = request.nextUrl;
  let redirectTo: URL | undefined;
  if (!signedIn && !PUBLIC_PATHS.includes(pathname)) {
    redirectTo = new URL("/login", request.url);
    if (pathname !== "/") redirectTo.searchParams.set("next", pathname + search);
  } else if (signedIn && pathname === "/login") {
    redirectTo = new URL("/", request.url);
  }
  if (!redirectTo) return response;

  // The redirect must carry any refreshed session cookies, or the browser keeps
  // a stale session and the user gets signed out.
  const redirect = NextResponse.redirect(redirectTo);
  response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  Object.entries(authHeaders).forEach(([header, value]) =>
    redirect.headers.set(header, value),
  );
  return redirect;
}

import { NextResponse, type NextRequest } from 'next/server';
import { API_ORIGIN } from '@/lib/api-origin';
import { decideRedirect, mergeSessionCookie, REFRESH_COOKIE, SESSION_COOKIE } from '@/lib/routing';

export const config = {
  // zxing_reader.wasm is the scanner's fallback decoder, and it is fetched by
  // the decoder rather than by a navigation, so a redirect to /login reaches it
  // as a failed instantiation. Left in, the fallback breaks on exactly the
  // devices it exists for.
  matcher: [
    '/((?!api/|_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|zxing_reader.wasm).*)',
  ],
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const hasRefresh = req.cookies.has(REFRESH_COOKIE);

  const redirect = decideRedirect({ pathname, hasSession, hasRefresh });
  if (redirect) return NextResponse.redirect(new URL(redirect.to, req.url));

  // Session expired but the 30-day refresh token is still here. Renew it now
  // so the navigation continues instead of bouncing the user to /login.
  if (!hasSession && hasRefresh) {
    const renewed = await fetch(`${API_ORIGIN}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '' },
    });

    if (!renewed.ok) {
      const res = NextResponse.redirect(new URL('/login', req.url));
      res.cookies.delete({ name: REFRESH_COOKIE, path: '/' });
      return res;
    }

    // Rewrite the current request's cookie header too, or the layout that
    // renders next still sends the expired session value and 401s.
    const setCookies = renewed.headers.getSetCookie();
    const headers = new Headers(req.headers);
    headers.set('cookie', mergeSessionCookie(req.headers.get('cookie') ?? '', setCookies));
    const res = NextResponse.next({ request: { headers } });
    for (const cookie of setCookies) {
      res.headers.append('set-cookie', cookie);
    }
    return res;
  }

  return NextResponse.next();
}

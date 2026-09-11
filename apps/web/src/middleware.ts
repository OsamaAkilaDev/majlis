import { NextResponse, type NextRequest } from 'next/server';
import { decideRedirect, REFRESH_COOKIE, SESSION_COOKIE } from '@/lib/routing';

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js).*)'],
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
    const renewed = await fetch(new URL('/api/v1/auth/refresh', req.url), {
      method: 'POST',
      headers: { cookie: req.headers.get('cookie') ?? '' },
    });

    if (!renewed.ok) {
      const res = NextResponse.redirect(new URL('/login', req.url));
      res.cookies.delete(REFRESH_COOKIE);
      return res;
    }

    const res = NextResponse.next();
    for (const cookie of renewed.headers.getSetCookie()) {
      res.headers.append('set-cookie', cookie);
    }
    return res;
  }

  return NextResponse.next();
}

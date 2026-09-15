import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { REFRESH_COOKIE, SESSION_COOKIE } from '../src/auth/cookies';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestPrisma } from './db';
import { uniq } from './factories';

const SIGNUP_PATH = `${API_PREFIX}/auth/signup`;
const LOGIN_PATH = `${API_PREFIX}/auth/login`;
const REFRESH_PATH = `${API_PREFIX}/auth/refresh`;
const USER_STATUS_PATH = (id: string) => `${API_PREFIX}/users/${id}/status`;

export interface SignupInput {
  email?: string;
  password?: string;
  fullName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoggedInUser {
  userId: string;
  /** A `name=value` pair, ready to pass straight to `.set('Cookie', ...)`. */
  sessionCookie: string;
}

export interface SignedUpUser extends LoggedInUser {
  /** A `name=value` pair, kept around so a test can present it again after
   * acting on the account (e.g. suspending it) to see whether it still works. */
  refreshCookie: string;
}

// vitest.integration.config.ts runs one worker per file (see factories.ts's
// identical `testDb()`), so one lazily-created client per file is fine here.
let db: ReturnType<typeof createTestPrisma> | undefined;
function testDb() {
  db ??= createTestPrisma();
  return db;
}

/**
 * POSTs to /auth/signup with sane, unique-by-default values, returning the
 * raw supertest response: callers read `.status`, `.body` (the
 * SessionUser), or `.headers['set-cookie']` as needed.
 */
export function signup(app: INestApplication, overrides: SignupInput = {}): request.Test {
  return request(app.getHttpServer())
    .post(SIGNUP_PATH)
    .send({
      email: overrides.email ?? `${uniq('user')}@uni.ac.ae`,
      password: overrides.password ?? 'correct-horse-battery',
      fullName: overrides.fullName ?? 'Test Person',
    });
}

/** POSTs to /auth/login, returning the raw supertest response. */
export function login(app: INestApplication, credentials: LoginInput): request.Test {
  return request(app.getHttpServer()).post(LOGIN_PATH).send(credentials);
}

/**
 * POSTs to /auth/refresh with the given `Cookie` header value, returning the
 * raw supertest response. `cookie` is normally the output of
 * `refreshCookieOf(...)`: a single `name=value` pair is all the refresh
 * route reads, so there's no need to send the session cookie alongside it.
 */
export function refresh(app: INestApplication, cookie: string): request.Test {
  return request(app.getHttpServer()).post(REFRESH_PATH).set('Cookie', cookie);
}

function sessionCookieFromResponse(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!raw) throw new Error('Response carried no session cookie: was the request rejected?');
  return raw.split(';')[0]!;
}

/**
 * Extracts the refresh cookie's `name=value` pair from any response that set
 * one (signup, login, or a previous refresh), ready to pass straight to
 * `refresh(app, ...)` or `.set('Cookie', ...)`.
 */
export function refreshCookieOf(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  if (!raw) throw new Error('Response carried no refresh cookie: was the request rejected?');
  return raw.split(';')[0]!;
}

/** The raw refresh token value carried in a response's refresh cookie. */
export function rawRefreshTokenFrom(res: request.Response): string {
  return refreshCookieOf(res).split('=')[1]!;
}

/**
 * Both cookies a response set, combined into one `Cookie` header value, for
 * a request (like logout) that should work regardless of which cookies are
 * presented.
 */
export function allCookiesOf(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[];
  return setCookie.map((c) => c.split(';')[0]).join('; ');
}

/**
 * Signs up a fresh STUDENT (the default for every new account) and returns
 * an authenticated context for it. Signup already issues a session, same as
 * login does, so there is no separate login round trip to make.
 */
export async function loginAsStudent(
  app: INestApplication,
  overrides: SignupInput = {},
): Promise<LoggedInUser> {
  const res = await signup(app, overrides);
  if (res.status !== 201) {
    throw new Error(`loginAsStudent: signup failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return { userId: (res.body as { id: string }).id, sessionCookie: sessionCookieFromResponse(res) };
}

/**
 * Signs up a fresh user, then promotes it to ADMIN with a direct Prisma
 * write: Stage 2 has no "make someone an Admin" route, so this is the only
 * way a test can reach one. The cookie from signup keeps working after the
 * promotion: SessionGuard re-reads `platformRole` from the database on every
 * request rather than trusting anything baked into the token, which is
 * exactly what makes a second login call unnecessary here.
 */
export async function loginAsAdmin(
  app: INestApplication,
  overrides: SignupInput = {},
): Promise<LoggedInUser> {
  const student = await loginAsStudent(app, overrides);
  await testDb().user.update({ where: { id: student.userId }, data: { platformRole: 'ADMIN' } });
  return student;
}

/**
 * Signs up a fresh STUDENT and keeps its refresh cookie too, not just the
 * session cookie `loginAsStudent` returns, for a test that needs to present
 * the refresh cookie again later (e.g. after suspending the account, to
 * check whether the token that was live at signup still works).
 */
export async function signupAndKeepCookies(
  app: INestApplication,
  overrides: SignupInput = {},
): Promise<SignedUpUser> {
  const res = await signup(app, overrides);
  if (res.status !== 201) {
    throw new Error(`signupAndKeepCookies: signup failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return {
    userId: (res.body as { id: string }).id,
    sessionCookie: sessionCookieFromResponse(res),
    refreshCookie: refreshCookieOf(res),
  };
}

/** PATCHes `/users/{id}/status` as whoever `cookie` belongs to. */
export function patchStatus(
  app: INestApplication,
  cookie: string,
  targetId: string,
  status: 'ACTIVE' | 'SUSPENDED',
  reason: string,
): request.Test {
  return request(app.getHttpServer())
    .patch(USER_STATUS_PATH(targetId))
    .set('Cookie', cookie)
    .send({ status, reason });
}

/**
 * Suspends `targetId` as a freshly-minted ADMIN (created here, thrown away
 * after), the shortest path to "some admin suspended this user" for a test
 * that doesn't care which admin did it.
 */
export async function suspendAsAdmin(
  app: INestApplication,
  targetId: string,
  reason: string,
): Promise<request.Response> {
  const admin = await loginAsAdmin(app);
  return patchStatus(app, admin.sessionCookie, targetId, 'SUSPENDED', reason);
}

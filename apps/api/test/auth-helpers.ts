import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SESSION_COOKIE } from '../src/auth/cookies';
import { API_PREFIX } from '../src/config/api-prefix';
import { createTestPrisma } from './db';
import { uniq } from './factories';

const SIGNUP_PATH = `${API_PREFIX}/auth/signup`;
const LOGIN_PATH = `${API_PREFIX}/auth/login`;

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

// vitest.integration.config.ts runs one worker per file (see factories.ts's
// identical `testDb()`), so one lazily-created client per file is fine here.
let db: ReturnType<typeof createTestPrisma> | undefined;
function testDb() {
  db ??= createTestPrisma();
  return db;
}

/**
 * POSTs to /auth/signup with sane, unique-by-default values, returning the
 * raw supertest response — callers read `.status`, `.body` (the
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

function sessionCookieFromResponse(res: request.Response): string {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const raw = setCookie?.find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  if (!raw) throw new Error('Response carried no session cookie — was the request rejected?');
  return raw.split(';')[0]!;
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
 * write — Stage 2 has no "make someone an Admin" route, so this is the only
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

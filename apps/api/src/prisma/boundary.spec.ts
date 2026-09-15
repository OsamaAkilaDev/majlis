import { ESLint } from 'eslint';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Guards the ESLint rule that keeps `PrismaService` injectable only inside
 * `src/prisma/`. A lint rule fails silently: a glob that matches nothing
 * leaves the repo green forever while the boundary it was meant to hold is
 * wide open. So this asserts in both directions: the rule fires where it
 * must, and stays quiet where it must not.
 *
 * `cwd` is `apps/api` under vitest, which is also how `pnpm lint` runs, so
 * ESLint discovers the root flat config exactly as it does in CI.
 */
const RULE = '@typescript-eslint/no-restricted-imports';

const eslint = new ESLint();

const INJECTS_PRISMA_SERVICE = `
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SomeService {
  constructor(private readonly prisma: PrismaService) {}
}
`;

async function boundaryErrors(relativePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: resolve(process.cwd(), relativePath),
  });
  return (result?.messages ?? []).filter((m) => m.ruleId === RULE).map((m) => m.message);
}

describe('PrismaService boundary', () => {
  // The first lintText loads the whole flat config; under a parallel suite run
  // that can pass vitest's 5s default and fail a test that is not actually slow.
  beforeAll(async () => {
    await boundaryErrors('src/warmup.ts', 'export const warm = 1;\n');
  }, 60_000);

  it('rejects injecting PrismaService from a service outside src/prisma/', async () => {
    const errors = await boundaryErrors('src/clubs/clubs.service.ts', INJECTS_PRISMA_SERVICE);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/TransactionHost/);
  });

  it('rejects it from a controller too, whatever the depth of the relative path', async () => {
    const deep = INJECTS_PRISMA_SERVICE.replace(
      '../prisma/prisma.service',
      '../../prisma/prisma.service',
    );

    expect(await boundaryErrors('src/clubs/team/team.controller.ts', deep)).toHaveLength(1);
  });

  it('allows it inside src/prisma/, where TransactionHost itself depends on it', async () => {
    const inside = INJECTS_PRISMA_SERVICE.replace('../prisma/prisma.service', './prisma.service');

    expect(await boundaryErrors('src/prisma/transaction.host.ts', inside)).toEqual([]);
  });

  it('allows a type-only import, which cannot become a DI injection', async () => {
    const typeOnly = INJECTS_PRISMA_SERVICE.replace(
      'import { PrismaService }',
      'import type { PrismaService }',
    );

    expect(await boundaryErrors('src/clubs/clubs.service.ts', typeOnly)).toEqual([]);
  });

  it('leaves test/ alone, where direct database access is the point', async () => {
    const errors = await boundaryErrors(
      'test/clubs.integration.test.ts',
      INJECTS_PRISMA_SERVICE.replace('../prisma/prisma.service', '../src/prisma/prisma.service'),
    );

    expect(errors).toEqual([]);
  });
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  // Vitest 5 transforms with oxc, and apps/web/tsconfig.json sets jsx: preserve,
  // which cannot be emitted. A later task's test imports a .tsx module.
  oxc: { jsx: { runtime: 'automatic' } },
});

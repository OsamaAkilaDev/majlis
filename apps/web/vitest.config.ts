import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Mirrors tsconfig's "@/*" path so a test can import a module that uses the alias.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  // Vitest 5 transforms with oxc, and apps/web/tsconfig.json sets jsx: preserve,
  // which cannot be emitted. A later task's test imports a .tsx module.
  oxc: { jsx: { runtime: 'automatic' } },
});

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['{src,test}/**/*.integration.test.ts'],
    environment: 'node',
    globals: false,
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // The test database is shared state; serializing file execution keeps
    // truncation honest. Vitest 5 removed `poolOptions.forks.singleFork` in
    // favor of this top-level flag (it forces maxWorkers to 1) — see
    // https://v4.vitest.dev/guide/migration#pool-rework
    pool: 'forks',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});

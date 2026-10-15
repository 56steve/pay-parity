import { defineConfig } from 'vitest/config';

// real deploys and real proofs against the local network, so everything is slow
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 10 * 60_000,
    hookTimeout: 15 * 60_000,
    sequence: { concurrent: false },
    disableConsoleIntercept: true,
  },
});

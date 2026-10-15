import { defineConfig } from 'vitest/config';

// fast, in-process tests; no network or proof server needed
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});

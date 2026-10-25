import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    // Bot searches and real-time server tests are slow on small machines.
    testTimeout: 20_000,
  },
});

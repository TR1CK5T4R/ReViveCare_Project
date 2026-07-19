import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    // Integration tests share one database (revivecare_test), so test files run
    // one at a time; each file truncates what it uses.
    fileParallelism: false,
    globalSetup: ['tests/setup/global-setup.js'],
    setupFiles: ['tests/setup/per-file.js'],
    // A few password tests run Django's real 1,200,000 PBKDF2 iterations.
    testTimeout: 30_000,
    coverage: { provider: 'v8', include: ['src/**'], reporter: ['text', 'html'] },
  },
});

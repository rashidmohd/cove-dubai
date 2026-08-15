import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Playwright owns the e2e suite; vitest must not try to run those files.
    exclude: ['e2e/**', 'node_modules/**'],
  },
});

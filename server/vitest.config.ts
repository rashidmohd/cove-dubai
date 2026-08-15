import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Tests run against the real hosted database — there is no local Postgres and
// no container in this project — so they need the same environment the service
// does. Loaded here rather than via a setup file so it is in place before any
// module that reads config is imported.
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Every query is a network round trip to Railway, and the concurrency test
    // deliberately makes transactions queue behind each other's row locks.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // These tests mutate shared inventory rows. Running files in parallel would
    // have them interfere with each other and produce flakes that look like
    // concurrency bugs.
    fileParallelism: false,
  },
});

import { defineConfig } from 'vitest/config';

/** Dev tools that run under Vitest (for TS + path support) but are not tests. */
export default defineConfig({
  test: { environment: 'node', include: ['tools/**/*.tool.ts'], testTimeout: 60000 },
});

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'packages/shared'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/__tests__/**/*.test.{ts,tsx}'],
    testTimeout: 10000,
    // NOTE: environmentMatchGlobs was removed in vitest 4.x.
    // Component tests under packages/shared/components/**/__tests__/ use the
    // `// @vitest-environment jsdom` docblock comment at the top of each file
    // to opt into jsdom. Server/node tests remain in the default node environment.
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['tests/e2e/**'],
  },
  projects: [
    {
      name: 'unit',
      test: { include: ['tests/cdp/**/*.test.js', 'tests/agent/**/*.test.js'] },
    },
    {
      name: 'e2e',
      test: { include: ['tests/e2e/**/*.test.js'], testTimeout: 60_000 },
    },
  ],
});

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/main.ts',
        'src/once.ts',
        'src/mcp-stdio-main.ts',
        'src/backtest.ts',
        'src/sources.ts',
      ],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
})

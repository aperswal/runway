import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import { TEST_CONFIG } from './test/config'

const deployedCrons = (): string[] => {
  const config = readFileSync(path.join(__dirname, 'wrangler.jsonc'), 'utf8')
  const block = /"crons":\s*\[([^\]]*)\]/.exec(config)?.[1] ?? ''
  return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '')
}

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          ...TEST_CONFIG,
          TEST_MIGRATIONS: await readD1Migrations(path.join(__dirname, 'migrations')),
          TEST_CRONS: deployedCrons(),
        },
      },
    })),
  ],
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 100, branches: 100, functions: 100, statements: 100 },
    },
  },
})

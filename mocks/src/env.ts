import { z } from 'zod'
import { ConfigError, issueDetail } from './errors.ts'

const DEFAULT_PORT = 9999
const DEFAULT_START_CASH = 1000

const blankToUndefined = (value: unknown): unknown => (value === '' ? undefined : value)

const schema = z.object({
  MOCK_PORT: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().positive().default(DEFAULT_PORT),
  ),
  MOCK_START_CASH: z.preprocess(
    blankToUndefined,
    z.coerce.number().nonnegative().default(DEFAULT_START_CASH),
  ),
  MOCK_MARKET_OPEN: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
})

export type MockConfig = {
  port: number
  startCash: number
  marketOpen: boolean | undefined
}

export function loadConfig(source: Record<string, string | undefined> = process.env): MockConfig {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    throw new ConfigError(`config: ${issueDetail(parsed.error.issues)}`)
  }
  const { MOCK_PORT, MOCK_START_CASH, MOCK_MARKET_OPEN } = parsed.data
  return {
    port: MOCK_PORT,
    startCash: MOCK_START_CASH,
    marketOpen: MOCK_MARKET_OPEN === undefined ? undefined : MOCK_MARKET_OPEN === 'true',
  }
}

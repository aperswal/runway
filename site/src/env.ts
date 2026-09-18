import type { Container } from '@cloudflare/containers'
import type { Ticker } from './ticker'
import { z } from 'zod'
import { ConfigError } from './errors'

const blankToUndefined = (value: string | undefined): string | undefined =>
  value !== undefined && value.length > 0 ? value : undefined
const optional = z.string().optional().transform(blankToUndefined)
const optionalUrl = z
  .url()
  .optional()
  .or(z.literal('').transform(() => undefined))

const MIN_TOKEN_LENGTH = 16
const DEFAULT_PLATFORM_USD = 5
const DEFAULT_X_POST_USD = 0.015
const DEFAULT_PAYOUT_FRACTION = 0.2

const schema = z.object({
  ALPACA_API_KEY: z.string().min(1),
  ALPACA_API_SECRET: z.string().min(1),
  ALPACA_PAPER: z.enum(['true', 'false']),
  ALPACA_TRADING_URL: optionalUrl,
  ALPACA_DATA_URL: optionalUrl,
  ALPACA_STREAM_URL: optionalUrl,
  SUBSCRIPTION_USD: z.coerce.number().positive(),
  PLATFORM_USD: z.coerce.number().nonnegative().default(DEFAULT_PLATFORM_USD),
  X_POST_USD: z.coerce.number().nonnegative().default(DEFAULT_X_POST_USD),
  PAYOUT_FRACTION: z.coerce.number().min(0).max(1).default(DEFAULT_PAYOUT_FRACTION),
  INTERNAL_TOKEN: z.string().min(MIN_TOKEN_LENGTH),
  DATA_TOKEN: z.string().min(MIN_TOKEN_LENGTH),
  SITE_URL: z.url(),
  CLAUDE_CODE_OAUTH_TOKEN: optional,
  AGENT_MODEL: optional,
  MANAGER_MODEL: optional,
  CODEX_MODEL: optional,
  RESEARCH_TOKEN: optional,
  X_API_URL: optionalUrl,
  X_API_KEY: optional,
  X_API_SECRET: optional,
  X_ACCESS_TOKEN: optional,
  X_ACCESS_SECRET: optional,
  LINKEDIN_API_URL: optionalUrl,
  LINKEDIN_ACCESS_TOKEN: optional,
  LINKEDIN_PERSON_URN: optional,
  APIFY_TOKEN: optional,
  YOUTUBE_API_KEY: optional,
  REDDIT_CLIENT_ID: optional,
  REDDIT_CLIENT_SECRET: optional,
  OPENAI_API_KEY: optional,
  DEEPINFRA_API_KEY: optional,
  DEEPINFRA_API_URL: optionalUrl,
  REWRITE_MODEL: optional,
})

export type Config = z.infer<typeof schema>

const X_KEYS = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET'] as const
const LINKEDIN_KEYS = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN'] as const

export function parseConfig(raw: Record<string, unknown>): Config {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ConfigError(
      `config: ${parsed.error.issues.map((i) => `${String(i.path[0])} ${i.message}`).join('; ')}`,
    )
  }
  requireAllOrNone(parsed.data, X_KEYS)
  requireAllOrNone(parsed.data, LINKEDIN_KEYS)
  return parsed.data
}

function requireAllOrNone(config: Config, keys: readonly (keyof Config)[]): void {
  const missing = keys.filter((k) => config[k] === undefined)
  if (missing.length !== 0 && missing.length !== keys.length) {
    throw new ConfigError(
      `config: set all of ${keys.join(', ')} or none (missing ${missing.join(', ')})`,
    )
  }
}

export type PostJob = { tradeId: number; kind: 'buy' | 'sell' }

export type Bindings = {
  DB: D1Database
  POSTS: Queue<PostJob>
  AGENT: DurableObjectNamespace<Container>
  TICKER: DurableObjectNamespace<Ticker>
}

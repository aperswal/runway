import { Alpaca, DATA_URL, LIVE_TRADING_URL, PAPER_TRADING_URL } from './alpaca'
import { createDb, type Db } from './db/client'
import { ratesFrom } from './costs'
import { parseConfig, type Bindings, type Config, type PostJob } from './env'
import type { SummaryOptions } from './summary-money'

export type Deps = {
  config: Config
  db: Db
  alpaca: Alpaca
  postQueue: Queue<PostJob>
  summary: SummaryOptions
}

export function buildDeps(env: Bindings & Record<string, unknown>): Deps {
  const config = parseConfig(env)
  const trading =
    config.ALPACA_TRADING_URL ??
    (config.ALPACA_PAPER === 'true' ? PAPER_TRADING_URL : LIVE_TRADING_URL)
  const urls = { trading, data: config.ALPACA_DATA_URL ?? DATA_URL }
  return {
    config,
    db: createDb(env.DB),
    alpaca: new Alpaca(config.ALPACA_API_KEY, config.ALPACA_API_SECRET, urls),
    postQueue: env.POSTS,
    summary: { rates: ratesFrom(config), payoutFraction: config.PAYOUT_FRACTION },
  }
}

export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  if (left.byteLength !== right.byteLength) {
    return false
  }
  return crypto.subtle.timingSafeEqual(left, right)
}

import { z } from 'zod'
import type { Db } from './db/client'
import type { Trade } from './db/schema'
import { assertExitsBracketPrice } from './guardrails'
import { requirePrice, setStatus, type TradeDeps } from './trades'

const MAX_TRAIL_PCT = 50
const PERCENT = 100
const CENTS_SCALE = 100

export const adjustExitsInput = z
  .object({
    fund: z.string().min(1).optional(),
    stop: z.number().positive().optional(),
    target: z.number().positive().optional(),
    trailPct: z.number().positive().max(MAX_TRAIL_PCT).nullable().optional(),
  })
  .refine(
    (v) => v.stop !== undefined || v.target !== undefined || v.trailPct !== undefined,
    'give a stop, a target, a trailing percentage, or several',
  )

export type AdjustExitsInput = z.infer<typeof adjustExitsInput>

export async function ratchetStop(db: Db, trade: Trade, price: number): Promise<Trade> {
  if (trade.trailPct === null) {
    return trade
  }
  const floor = Math.floor(price * (1 - trade.trailPct / PERCENT) * CENTS_SCALE) / CENTS_SCALE
  if (floor <= trade.stop) {
    return trade
  }
  return setStatus(db, trade.id, 'open', { stop: floor })
}

export async function adjustExits(
  deps: TradeDeps,
  trade: Trade,
  input: AdjustExitsInput,
): Promise<Trade> {
  const prices = await deps.alpaca.latestPrices([trade.symbol])
  const price = requirePrice(prices, trade.symbol)
  const stop = input.stop ?? trade.stop
  const target = input.target ?? trade.target
  assertExitsBracketPrice(stop, target, price)
  const trailPct = input.trailPct === undefined ? trade.trailPct : input.trailPct
  return setStatus(deps.db, trade.id, 'open', { stop, target, trailPct })
}

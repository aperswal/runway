import { z } from 'zod'
import { AlpacaBadRequestError, AlpacaNotFoundError } from '../errors.ts'
import type { MockRequest } from '../http.ts'
import { basePrice, hashSymbol, multiplierOf, roundCents, type PriceFeed } from './prices.ts'

const OCC = /^[A-Z]{1,6}\d{6}[CP]\d{8}$/
const STRIKE_SCALE = 1000
const STRIKE_DIGITS = 8
const DATE_DIGITS = 6
const STRIKES_EACH_SIDE = 2
const STRIKE_STEPS = Array.from(
  { length: STRIKES_EACH_SIDE + STRIKES_EACH_SIDE + 1 },
  (_, i) => i - STRIKES_EACH_SIDE,
)
const STRIKE_STEP_FRACTION = 0.05
const MONTH_DAYS = 30
const EXPIRIES = 2
const EXPIRY_DAYS = Array.from({ length: EXPIRIES }, (_, i) => MONTH_DAYS * (i + 1))
const DAY_MS = 86_400_000
const DEFAULT_LIMIT = 100
const OPEN_INTEREST_SPAN = 5000
const IV_BASE = 0.3
const IV_SPAN = 0.4
const DELTA_CALL = 0.5
const DATE_LENGTH = 10
const QUOTE_SPREAD = 0.05
const QUOTE_SIZE = 10
const CENTURY = 2000
const YEAR_DIGITS = 2

export type Contract = {
  symbol: string
  underlying: string
  expiration: string
  type: 'call' | 'put'
  strike: number
}

const TAIL = 15
const DATE_AT = -15
const KIND_AT = -9
const STRIKE_AT = -8

export function parseContract(symbol: string): Contract {
  if (!OCC.test(symbol)) {
    throw new AlpacaNotFoundError('option contract not found')
  }
  const date = symbol.slice(DATE_AT, KIND_AT)
  const year = CENTURY + Number(date.slice(0, YEAR_DIGITS))
  const expiration = `${year}-${date.slice(YEAR_DIGITS, YEAR_DIGITS + YEAR_DIGITS)}-${date.slice(YEAR_DIGITS + YEAR_DIGITS, DATE_DIGITS)}`
  return {
    symbol,
    underlying: symbol.slice(0, -TAIL),
    expiration,
    type: symbol.slice(KIND_AT, STRIKE_AT) === 'C' ? 'call' : 'put',
    strike: Number(symbol.slice(STRIKE_AT)) / STRIKE_SCALE,
  }
}

const occSymbol = (underlying: string, expiration: string, type: 'call' | 'put', strike: number) =>
  `${underlying}${expiration.slice(YEAR_DIGITS).replace(/-/g, '')}${type === 'call' ? 'C' : 'P'}${String(Math.round(strike * STRIKE_SCALE)).padStart(STRIKE_DIGITS, '0')}`

const roundStrike = (value: number): number => Math.max(1, Math.round(value))

export function chainFor(underlying: string, now: Date): Contract[] {
  const spot = basePrice(underlying)
  const expirations = EXPIRY_DAYS.map((days) =>
    new Date(now.getTime() + days * DAY_MS).toISOString().slice(0, DATE_LENGTH),
  )
  return expirations.flatMap((expiration) =>
    STRIKE_STEPS.flatMap((step) => {
      const strike = roundStrike(spot * (1 + step * STRIKE_STEP_FRACTION))
      return (['call', 'put'] as const).map((type) => ({
        symbol: occSymbol(underlying, expiration, type, strike),
        underlying,
        expiration,
        type,
        strike,
      }))
    }),
  )
}

const querySchema = z.object({
  underlying_symbols: z.string().min(1),
  type: z.enum(['call', 'put']).optional(),
  expiration_date_gte: z.string().optional(),
  expiration_date_lte: z.string().optional(),
  strike_price_gte: z.coerce.number().optional(),
  strike_price_lte: z.coerce.number().optional(),
  limit: z.coerce.number().int().positive().optional(),
})

const within = (value: number, min: number | undefined, max: number | undefined): boolean =>
  (min === undefined || value >= min) && (max === undefined || value <= max)

export function searchContracts(request: MockRequest, now: Date): Contract[] {
  const parsed = querySchema.safeParse(Object.fromEntries(request.query.entries()))
  if (!parsed.success) {
    throw new AlpacaBadRequestError('underlying_symbols query parameter is required')
  }
  const q = parsed.data
  return q.underlying_symbols
    .split(',')
    .flatMap((u) => chainFor(u.trim().toUpperCase(), now))
    .filter((c) => q.type === undefined || c.type === q.type)
    .filter((c) => within(c.strike, q.strike_price_gte, q.strike_price_lte))
    .filter(
      (c) =>
        (q.expiration_date_gte === undefined || c.expiration >= q.expiration_date_gte) &&
        (q.expiration_date_lte === undefined || c.expiration <= q.expiration_date_lte),
    )
    .slice(0, q.limit ?? DEFAULT_LIMIT)
}

export function contractView(c: Contract, prices: PriceFeed): Record<string, unknown> {
  return {
    id: `opt-${hashSymbol(c.symbol)}`,
    symbol: c.symbol,
    name: `${c.underlying} ${c.expiration} ${c.type} ${c.strike}`,
    status: 'active',
    tradable: true,
    expiration_date: c.expiration,
    root_symbol: c.underlying,
    underlying_symbol: c.underlying,
    underlying_asset_id: `asset-${hashSymbol(c.underlying)}`,
    type: c.type,
    style: 'american',
    strike_price: String(c.strike),
    multiplier: String(multiplierOf(c.symbol)),
    size: String(multiplierOf(c.symbol)),
    open_interest: String(hashSymbol(c.symbol) % OPEN_INTEREST_SPAN),
    open_interest_date: null,
    close_price: String(prices.current(c.symbol)),
    close_price_date: null,
  }
}

export function snapshotView(
  symbol: string,
  prices: PriceFeed,
  at: string,
): Record<string, unknown> {
  const c = parseContract(symbol)
  const price = prices.current(symbol)
  const iv = IV_BASE + ((hashSymbol(symbol) % OPEN_INTEREST_SPAN) / OPEN_INTEREST_SPAN) * IV_SPAN
  const delta = c.type === 'call' ? DELTA_CALL : -DELTA_CALL
  return {
    latestTrade: { t: at, p: price, s: 1, x: 'C', c: ['I'] },
    latestQuote: {
      t: at,
      ap: roundCents(price + QUOTE_SPREAD),
      as: QUOTE_SIZE,
      bp: roundCents(price - QUOTE_SPREAD),
      bs: QUOTE_SIZE,
    },
    impliedVolatility: roundCents(iv),
    greeks: {
      delta,
      gamma: roundCents(Math.abs(delta) / c.strike),
      theta: -0.01,
      vega: 0.1,
      rho: 0.01,
    },
  }
}

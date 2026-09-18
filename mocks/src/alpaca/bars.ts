import { basePrice, hashSymbol, mulberry32, roundCents } from './prices.ts'

export type Bar = {
  t: string
  o: number
  h: number
  l: number
  c: number
  v: number
  n: number
  vw: number
}

export type BarRange = { start: Date; end: Date; limit: number }

const DAY_MS = 86400000
const HALF = 0.5
const OHLC_COUNT = 4
const DAILY_MOVE = 0.04
const WICK = 0.02
const BASE_VOLUME = 100000
const VOLUME_SPAN = 900000
const TRADES_PER_VOLUME = 100
const DEFAULT_DAYS = 30
const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 10000
const SATURDAY = 6
const SUNDAY = 0

const dayStart = (date: Date): number => Math.floor(date.getTime() / DAY_MS) * DAY_MS

export function barRange(query: URLSearchParams, now: Date): BarRange {
  const end = parseDate(query.get('end')) ?? now
  const start = parseDate(query.get('start')) ?? new Date(end.getTime() - DEFAULT_DAYS * DAY_MS)
  const requested = Number(query.get('limit') ?? DEFAULT_LIMIT)
  const limit =
    Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_LIMIT) : DEFAULT_LIMIT
  return { start, end, limit }
}

const parseDate = (value: string | null): Date | undefined => {
  if (value === null) {
    return undefined
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export function dailyBars(symbol: string, range: BarRange): Bar[] {
  const random = mulberry32(hashSymbol(symbol) ^ dayStart(range.start))
  const bars: Bar[] = []
  let close = basePrice(symbol)
  for (let t = dayStart(range.start); t <= range.end.getTime(); t += DAY_MS) {
    const open = close
    close = roundCents(open * (1 + (random() - HALF) * DAILY_MOVE))
    const high = roundCents(Math.max(open, close) * (1 + random() * WICK))
    const low = roundCents(Math.min(open, close) * (1 - random() * WICK))
    const volume = Math.floor(BASE_VOLUME + random() * VOLUME_SPAN)
    bars.push({
      t: new Date(t).toISOString(),
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
      n: Math.floor(volume / TRADES_PER_VOLUME),
      vw: roundCents((open + close + high + low) / OHLC_COUNT),
    })
  }
  return bars
}

export const isWeekdayBar = (bar: Bar): boolean => {
  const day = new Date(bar.t).getUTCDay()
  return day !== SATURDAY && day !== SUNDAY
}

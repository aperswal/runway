import { hashSymbol, roundCents, type PriceFeed } from './prices.ts'

export type Mover = { symbol: string; percent_change: number; change: number; price: number }
export type MostActive = { symbol: string; volume: number; trade_count: number }

export const STOCK_UNIVERSE = [
  'AAPL',
  'MSFT',
  'NVDA',
  'TSLA',
  'AMZN',
  'GOOGL',
  'META',
  'AMD',
  'NFLX',
  'COIN',
]
export const CRYPTO_UNIVERSE = ['BTC/USD', 'ETH/USD', 'SOL/USD', 'DOGE/USD', 'LTC/USD', 'AVAX/USD']

const PERCENT_SPAN = 2000
const PERCENT_SCALE = 100
const PERCENT_CENTER = 10
const PERCENT = 100
const VOLUME_SPAN = 50000000
const TRADES_PER_VOLUME = 50
const DEFAULT_TOP = 10

const percentChange = (symbol: string): number =>
  roundCents((hashSymbol(symbol) % PERCENT_SPAN) / PERCENT_SCALE - PERCENT_CENTER)

export const topCount = (query: URLSearchParams): number => {
  const top = Number(query.get('top') ?? DEFAULT_TOP)
  return Number.isInteger(top) && top > 0 ? top : DEFAULT_TOP
}

export function moversView(
  universe: string[],
  prices: PriceFeed,
  top: number,
): { gainers: Mover[]; losers: Mover[] } {
  const movers = universe.map((symbol) => {
    const price = prices.current(symbol)
    const percent = percentChange(symbol)
    return {
      symbol,
      percent_change: percent,
      change: roundCents((price * percent) / PERCENT),
      price,
    }
  })
  const gainers = movers
    .filter((m) => m.percent_change > 0)
    .sort((a, b) => b.percent_change - a.percent_change)
    .slice(0, top)
  const losers = movers
    .filter((m) => m.percent_change <= 0)
    .sort((a, b) => a.percent_change - b.percent_change)
    .slice(0, top)
  return { gainers, losers }
}

export function mostActivesView(universe: string[], top: number): MostActive[] {
  return universe
    .map((symbol) => {
      const volume = hashSymbol(symbol) % VOLUME_SPAN
      return { symbol, volume, trade_count: Math.floor(volume / TRADES_PER_VOLUME) }
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, top)
}

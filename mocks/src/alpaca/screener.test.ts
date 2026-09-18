import { describe, expect, it } from 'vitest'
import { PriceFeed } from './prices.ts'
import {
  CRYPTO_UNIVERSE,
  STOCK_UNIVERSE,
  mostActivesView,
  moversView,
  topCount,
} from './screener.ts'

const flatFeed = (universe: string[]): PriceFeed => {
  const feed = new PriceFeed()
  for (const symbol of universe) {
    feed.set(symbol, 100)
  }
  return feed
}

describe('universes', () => {
  it('lists the fixed symbols', () => {
    expect(STOCK_UNIVERSE).toEqual([
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
    ])
    expect(CRYPTO_UNIVERSE).toEqual([
      'BTC/USD',
      'ETH/USD',
      'SOL/USD',
      'DOGE/USD',
      'LTC/USD',
      'AVAX/USD',
    ])
  })
})

describe('topCount', () => {
  it('defaults and validates', () => {
    expect(topCount(new URLSearchParams())).toBe(10)
    expect(topCount(new URLSearchParams({ top: '3' }))).toBe(3)
    expect(topCount(new URLSearchParams({ top: '0' }))).toBe(10)
    expect(topCount(new URLSearchParams({ top: '-1' }))).toBe(10)
    expect(topCount(new URLSearchParams({ top: '1.5' }))).toBe(10)
    expect(topCount(new URLSearchParams({ top: 'x' }))).toBe(10)
  })
})

describe('moversView', () => {
  it('ranks stock gainers and losers by percent change and caps each side', () => {
    expect(moversView(STOCK_UNIVERSE, flatFeed(STOCK_UNIVERSE), 2)).toEqual({
      gainers: [
        { symbol: 'MSFT', percent_change: 6.83, change: 6.86, price: 100.45 },
        { symbol: 'AMD', percent_change: 4.29, change: 4.27, price: 99.59 },
      ],
      losers: [
        { symbol: 'NVDA', percent_change: -8.98, change: -8.99, price: 100.12 },
        { symbol: 'META', percent_change: -7.04, change: -7.01, price: 99.64 },
      ],
    })
  })

  it('orders the whole universe when the cap is large', () => {
    const { gainers, losers } = moversView(STOCK_UNIVERSE, new PriceFeed(), 10)
    expect(gainers.map((m) => [m.symbol, m.percent_change])).toEqual([
      ['MSFT', 6.83],
      ['AMD', 4.29],
      ['TSLA', 3.75],
      ['COIN', 2.6],
    ])
    expect(losers.map((m) => [m.symbol, m.percent_change])).toEqual([
      ['NVDA', -8.98],
      ['META', -7.04],
      ['NFLX', -5.43],
      ['AMZN', -4.41],
      ['GOOGL', -3.05],
      ['AAPL', -0.45],
    ])
  })

  it('ranks crypto movers', () => {
    const { gainers, losers } = moversView(CRYPTO_UNIVERSE, new PriceFeed(), 10)
    expect(gainers.map((m) => m.symbol)).toEqual(['DOGE/USD', 'ETH/USD', 'SOL/USD', 'BTC/USD'])
    expect(losers.map((m) => m.symbol)).toEqual(['AVAX/USD', 'LTC/USD'])
  })

  it('counts an unchanged symbol as a loser', () => {
    const feed = new PriceFeed()
    feed.set('ACU', 100)
    expect(moversView(['ACU'], feed, 10)).toEqual({
      gainers: [],
      losers: [{ symbol: 'ACU', percent_change: 0, change: 0, price: 99.6 }],
    })
  })
})

describe('mostActivesView', () => {
  it('ranks by volume with trade counts', () => {
    expect(mostActivesView(STOCK_UNIVERSE, 3)).toEqual([
      { symbol: 'AMZN', volume: 45290559, trade_count: 905811 },
      { symbol: 'NVDA', volume: 41302102, trade_count: 826042 },
      { symbol: 'AAPL', volume: 39842955, trade_count: 796859 },
    ])
    expect(mostActivesView(STOCK_UNIVERSE, 10).map((a) => a.symbol)).toEqual([
      'AMZN',
      'NVDA',
      'AAPL',
      'AMD',
      'MSFT',
      'META',
      'COIN',
      'GOOGL',
      'TSLA',
      'NFLX',
    ])
  })
})

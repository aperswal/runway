import { describe, expect, it } from 'vitest'
import {
  PriceFeed,
  basePrice,
  canonicalSymbol,
  hashSymbol,
  isCrypto,
  mulberry32,
  positionSymbol,
  roundCents,
  roundQty,
} from './prices.ts'

describe('symbols', () => {
  it('detects crypto by slash or USD suffix', () => {
    expect(isCrypto('BTC/USD')).toBe(true)
    expect(isCrypto('BTCUSD')).toBe(true)
    expect(isCrypto('AAPL')).toBe(false)
  })

  it('canonicalizes and derives position symbols', () => {
    expect(canonicalSymbol('btcusd')).toBe('BTC/USD')
    expect(canonicalSymbol('dogeusd')).toBe('DOGE/USD')
    expect(canonicalSymbol('BTC/USD')).toBe('BTC/USD')
    expect(canonicalSymbol('aapl')).toBe('AAPL')
    expect(positionSymbol('BTC/USD')).toBe('BTCUSD')
    expect(positionSymbol('AAPL')).toBe('AAPL')
  })
})

describe('deterministic prices', () => {
  it('hashes with fnv-1a', () => {
    expect(hashSymbol('')).toBe(2166136261)
    expect(hashSymbol('AAPL')).toBe(1489842955)
    expect(hashSymbol('MSFT')).toBe(3383597683)
    expect(hashSymbol('BTC/USD')).toBe(4164773103)
  })

  it('seeds mulberry32 reproducibly', () => {
    const random = mulberry32(1)
    expect([random(), random(), random()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ])
    expect(mulberry32(1)()).toBe(0.6270739405881613)
  })

  it('derives base prices from the canonical symbol', () => {
    expect(basePrice('AAPL')).toBe(875)
    expect(basePrice('aapl')).toBe(875)
    expect(basePrice('BTC/USD')).toBe(523)
    expect(basePrice('btcusd')).toBe(523)
  })

  it('rounds money and quantities', () => {
    expect(roundCents(1.234)).toBe(1.23)
    expect(roundCents(1.235)).toBe(1.24)
    expect(roundQty(1 / 3)).toBe(0.333333333)
    expect(roundQty(2)).toBe(2)
  })

  it('drifts prices deterministically per symbol from the base price', () => {
    const feed = new PriceFeed()
    expect([feed.current('AAPL'), feed.current('AAPL'), feed.current('AAPL')]).toEqual([
      878.62, 879.03, 875.96,
    ])
    expect(feed.snapshot()).toEqual({ AAPL: 875.96 })
    expect(new PriceFeed().current('aapl')).toBe(878.62)
  })

  it('drifts from overrides, snapshots and resets', () => {
    const feed = new PriceFeed()
    feed.set('btcusd', 100.129)
    expect(feed.snapshot()).toEqual({ 'BTC/USD': 100.13 })
    expect([feed.current('BTC/USD'), feed.current('btcusd')]).toEqual([100.24, 100.7])
    feed.reset()
    expect(feed.snapshot()).toEqual({})
    expect(feed.current('BTC/USD')).toBe(new PriceFeed().current('BTC/USD'))
  })
})

import { describe, expect, it } from 'vitest'
import { AlpacaBadRequestError, AlpacaNotFoundError } from '../errors.ts'
import type { MockRequest } from '../http.ts'
import { chainFor, contractView, parseContract, searchContracts, snapshotView } from './options.ts'
import {
  PriceFeed,
  basePrice,
  hashSymbol,
  isOptionSymbol,
  multiplierOf,
  roundCents,
} from './prices.ts'

const NOW = new Date('2026-09-01T15:00:00.000Z')
const request = (query: Record<string, string>): MockRequest => ({
  method: 'GET',
  path: '/v2/options/contracts',
  query: new URLSearchParams(query),
  headers: new Headers(),
  body: undefined,
  bytes: new Uint8Array(),
  origin: 'http://h',
})

describe('option symbols', () => {
  it('recognises OCC symbols, prices them as premiums and gives them a 100 multiplier', () => {
    expect(isOptionSymbol('AAPL260116C00190000')).toBe(true)
    expect(isOptionSymbol('AAPL')).toBe(false)
    expect(multiplierOf('AAPL260116C00190000')).toBe(100)
    expect(multiplierOf('BTC/USD')).toBe(1)
    expect(basePrice('AAPL260116C00190000')).toBeLessThan(11)
    expect(basePrice('AAPL')).toBeGreaterThanOrEqual(10)
  })
  it('parses contracts and rejects other symbols', () => {
    expect(parseContract('AAPL260116C00190000')).toEqual({
      symbol: 'AAPL260116C00190000',
      underlying: 'AAPL',
      expiration: '2026-01-16',
      type: 'call',
      strike: 190,
    })
    expect(parseContract('SPY261218P00450500')).toMatchObject({ type: 'put', strike: 450.5 })
    expect(() => parseContract('AAPL')).toThrow(
      new AlpacaNotFoundError('option contract not found'),
    )
    expect(() => parseContract('AAPL260116C00190000X')).toThrow(AlpacaNotFoundError)
    expect(() => parseContract('1AAPL260116C00190000')).toThrow(AlpacaNotFoundError)
    expect(isOptionSymbol('AAPL260116C00190000X')).toBe(false)
    expect(isOptionSymbol('1AAPL260116C00190000')).toBe(false)
  })
})

describe('chainFor and searchContracts', () => {
  it('builds two expiries of five strikes for calls and puts around the spot price', () => {
    const chain = chainFor('AAPL', NOW)
    expect(chain).toHaveLength(20)
    expect(new Set(chain.map((c) => c.expiration))).toEqual(new Set(['2026-10-01', '2026-10-31']))
    const spot = basePrice('AAPL')
    const strikes = [-2, -1, 0, 1, 2].map((k) => Math.max(1, Math.round(spot * (1 + k * 0.05))))
    expect(chain.slice(0, 10).map((c) => c.strike)).toEqual(strikes.flatMap((s) => [s, s]))
    for (const c of chain) {
      expect(parseContract(c.symbol)).toEqual(c)
    }
  })
  it('filters by type, strike, expiry and limit', () => {
    const all = searchContracts(request({ underlying_symbols: 'aapl' }), NOW)
    expect(all).toHaveLength(20)
    const calls = searchContracts(request({ underlying_symbols: 'AAPL', type: 'call' }), NOW)
    expect(calls.every((c) => c.type === 'call')).toBe(true)
    const spot = basePrice('AAPL')
    const near = searchContracts(
      request({
        underlying_symbols: 'AAPL',
        strike_price_gte: String(spot - 1),
        strike_price_lte: String(spot + 1),
        expiration_date_gte: '2026-10-15',
        expiration_date_lte: '2026-12-31',
      }),
      NOW,
    )
    expect(near.every((c) => c.expiration === '2026-10-31')).toBe(true)
    expect(near.length).toBeGreaterThan(0)
    const strikes = [...new Set(all.map((c) => c.strike))].sort((a, b) => a - b)
    const [low = 0] = strikes
    const high = strikes.at(-1) ?? 0
    const count = (query: Record<string, string>): number =>
      searchContracts(request({ underlying_symbols: 'AAPL', ...query }), NOW).length
    expect(count({ strike_price_gte: String(high) })).toBe(4)
    expect(count({ strike_price_gte: String(high + 0.01) })).toBe(0)
    expect(count({ strike_price_lte: String(low) })).toBe(4)
    expect(count({ strike_price_lte: String(low - 0.01) })).toBe(0)
    expect(count({ strike_price_gte: String(low), strike_price_lte: String(low) })).toBe(4)
    expect(count({ expiration_date_gte: '2026-10-01' })).toBe(20)
    expect(count({ expiration_date_gte: '2026-10-02' })).toBe(10)
    expect(count({ expiration_date_lte: '2026-10-31' })).toBe(20)
    expect(count({ expiration_date_lte: '2026-10-30' })).toBe(10)
    expect(count({ expiration_date_gte: '2026-10-02', expiration_date_lte: '2026-10-30' })).toBe(0)
    expect(
      searchContracts(request({ underlying_symbols: 'AAPL,MSFT', limit: '3' }), NOW),
    ).toHaveLength(3)
    expect(searchContracts(request({ underlying_symbols: 'AAPL,MSFT' }), NOW)).toHaveLength(40)
    const spaced = searchContracts(request({ underlying_symbols: ' aapl ' }), NOW)
    expect(spaced[0]?.symbol.startsWith('AAPL2')).toBe(true)
    expect(() => searchContracts(request({}), NOW)).toThrow(
      new AlpacaBadRequestError('underlying_symbols query parameter is required'),
    )
  })
})

describe('views', () => {
  it('renders a contract and a snapshot', () => {
    const prices = new PriceFeed()
    prices.set('AAPL260116C00190000', 4)
    const view = contractView(parseContract('AAPL260116C00190000'), prices)
    expect(view).toMatchObject({
      id: `opt-${hashSymbol('AAPL260116C00190000')}`,
      symbol: 'AAPL260116C00190000',
      name: 'AAPL 2026-01-16 call 190',
      status: 'active',
      style: 'american',
      underlying_symbol: 'AAPL',
      underlying_asset_id: `asset-${hashSymbol('AAPL')}`,
      expiration_date: '2026-01-16',
      type: 'call',
      strike_price: '190',
      multiplier: '100',
      tradable: true,
    })
    expect(Number(view.open_interest)).toBe(hashSymbol('AAPL260116C00190000') % 5000)
    prices.set('AAPL260116P00190000', 4)
    const snap = snapshotView('AAPL260116P00190000', prices, NOW.toISOString())
    expect(snap).toMatchObject({ greeks: { delta: -0.5 } })
    const symbol = 'AAPL260116C00190000'
    const call = snapshotView(symbol, prices, NOW.toISOString())
    const price = (call.latestTrade as { p: number }).p
    expect(call.latestTrade).toEqual({ t: NOW.toISOString(), p: price, s: 1, x: 'C', c: ['I'] })
    expect(call.latestQuote).toEqual({
      t: NOW.toISOString(),
      ap: roundCents(price + 0.05),
      as: 10,
      bp: roundCents(price - 0.05),
      bs: 10,
    })
    expect(call.impliedVolatility).toBe(
      roundCents(0.3 + ((hashSymbol(symbol) % 5000) / 5000) * 0.4),
    )
    expect(call.greeks).toEqual({
      delta: 0.5,
      gamma: roundCents(0.5 / 190),
      theta: -0.01,
      vega: 0.1,
      rho: 0.01,
    })
  })
})

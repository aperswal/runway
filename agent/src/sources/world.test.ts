import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceError } from '../errors.ts'
import type { Command } from './source.ts'
import { world } from './world.ts'

const quote: Command['run'] = (flags, keys) => world.commands[0]!.run(flags, keys)
const history: Command['run'] = (flags, keys) => world.commands[1]!.run(flags, keys)

const chart = (over: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) => ({
  chart: {
    result: [
      {
        meta: {
          symbol: '7203.T',
          currency: 'JPY',
          exchangeName: 'JPX',
          regularMarketPrice: 2600,
          chartPreviousClose: 2500,
          regularMarketTime: 1_756_800_000,
          ...meta,
        },
        timestamp: [1_756_713_600, 1_756_800_000, 1_756_886_400],
        indicators: { quote: [{ close: [2400, null, 2600] }] },
        ...over,
      },
    ],
    error: null,
  },
})

const stub = (bodies: unknown[]) => {
  const calls: string[] = []
  const inits: RequestInit[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit) => {
      calls.push(url)
      inits.push(init)
      return Promise.resolve(new Response(JSON.stringify(bodies.shift())))
    }),
  )
  return Object.assign(calls, { inits })
}

afterEach(() => vi.unstubAllGlobals())

describe('world quote', () => {
  it('fetches every symbol in parallel and reports price, change and time', async () => {
    const calls = stub([chart(), chart({}, { symbol: '^N225', regularMarketPrice: null })])
    await expect(quote({ symbols: ' 7203.T, ^N225 ,' }, {})).resolves.toEqual([
      {
        symbol: '7203.T',
        currency: 'JPY',
        exchange: 'JPX',
        price: 2600,
        previousClose: 2500,
        changePct: 4,
        asOf: '2025-09-02T08:00:00.000Z',
      },
      {
        symbol: '^N225',
        currency: 'JPY',
        exchange: 'JPX',
        price: null,
        previousClose: 2500,
        changePct: null,
        asOf: '2025-09-02T08:00:00.000Z',
      },
    ])
    expect([...calls]).toEqual([
      'https://query1.finance.yahoo.com/v8/finance/chart/7203.T?range=5d&interval=1d',
      'https://query1.finance.yahoo.com/v8/finance/chart/%5EN225?range=5d&interval=1d',
    ])
    expect(calls.inits[0]).toEqual({ headers: { 'user-agent': 'Mozilla/5.0 (runway research)' } })
  })
  it('handles missing meta fields and a zero previous close', async () => {
    stub([
      chart(
        {},
        {
          currency: null,
          exchangeName: undefined,
          chartPreviousClose: 0,
          regularMarketTime: null,
        },
      ),
    ])
    await expect(quote({ symbols: 'X' }, {})).resolves.toEqual([
      {
        symbol: '7203.T',
        currency: '',
        exchange: '',
        price: 2600,
        previousClose: 0,
        changePct: null,
        asOf: null,
      },
    ])
    stub([chart({}, { chartPreviousClose: null })])
    await expect(quote({ symbols: 'X' }, {})).resolves.toMatchObject([{ changePct: null }])
    stub([chart({}, { regularMarketTime: undefined })])
    await expect(quote({ symbols: 'X' }, {})).resolves.toMatchObject([{ asOf: null }])
  })
  it('surfaces Yahoo errors and empty results', async () => {
    stub([{ chart: { result: null, error: { description: 'No data found' } } }])
    await expect(quote({ symbols: 'NOPE' }, {})).rejects.toThrow(
      new SourceError('NOPE: No data found'),
    )
    stub([{ chart: { result: [], error: null } }])
    await expect(quote({ symbols: 'NOPE' }, {})).rejects.toThrow('NOPE: no data')
    await expect(quote({}, {})).rejects.toThrow()
  })
})

describe('world history', () => {
  it('returns dated closes, skipping empty candles, with default range and interval', async () => {
    const calls = stub([chart()])
    await expect(history({ symbol: '7203.T' }, {})).resolves.toEqual([
      { date: '2025-09-01', close: 2400 },
      { date: '2025-09-03', close: 2600 },
    ])
    expect(calls[0]).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/7203.T?range=3mo&interval=1d',
    )
  })
  it('passes range and interval through and tolerates missing arrays', async () => {
    const calls = stub([chart({ timestamp: null })])
    await expect(history({ symbol: 'X', range: '1y', interval: '1wk' }, {})).resolves.toEqual([])
    expect(calls[0]).toContain('?range=1y&interval=1wk')
    stub([chart({ timestamp: [1_756_713_600], indicators: { quote: [] } })])
    await expect(history({ symbol: 'X' }, {})).resolves.toEqual([])
    stub([chart({ indicators: { quote: [{ close: [1] }] } })])
    await expect(history({ symbol: 'X' }, {})).resolves.toEqual([{ date: '2025-09-01', close: 1 }])
  })
})

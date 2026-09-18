import { beforeEach, describe, expect, it } from 'vitest'
import { alpacaCall, readJson, setup, type Call } from '../test-support.ts'

const DATA = '/alpaca-data'
const AT = '2026-09-01T15:00:00.000Z'

type Trade = Record<string, unknown> & { p: number }
type Trades = { trades: Record<string, Trade>; currency?: string }
type News = { news: { symbols: string[] }[]; next_page_token: null }
type Bar = { t: string; o: number; c: number }
type Bars = { bars: Record<string, Bar[]>; next_page_token: null; currency?: string }
type Snapshot = {
  latestTrade: Trade
  latestQuote: Record<string, unknown>
  minuteBar: Bar
  dailyBar: Bar
  prevDailyBar: Bar
}
type Movers = { market_type: string; gainers: { symbol: string }[]; losers: unknown[] }
type Actives = { most_actives: unknown[] }

const cents = (value: number) => Math.round(value * 100) / 100

describe('market data api', () => {
  let call: Call

  beforeEach(() => {
    const built = setup()
    call = alpacaCall(built.call)
    built.deps.state.prices.set('AAPL', 100)
  })

  it('requires auth like the trading api', async () => {
    const res = await setup().call('GET', `${DATA}/v2/stocks/trades/latest?symbols=AAPL`)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ message: 'unauthorized.' })
  })

  it('serves option trades, snapshots and whole chains', async () => {
    const symbol = 'AAPL260116C00190000'
    type OptionTrades = { trades: Record<string, { p: number }> }
    type Snaps = { snapshots: Record<string, { greeks: { delta: number } }> }
    const trades = await readJson<OptionTrades>(
      await call('GET', `${DATA}/v1beta1/options/trades/latest?symbols=${symbol}`),
    )
    expect(trades.trades[symbol]?.p).toBeLessThan(11)
    expect((trades.trades[symbol] as unknown as { t: string }).t).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const snaps = await readJson<Snaps>(
      await call('GET', `${DATA}/v1beta1/options/snapshots?symbols=${symbol}`),
    )
    expect(snaps.snapshots[symbol]).toMatchObject({ greeks: { delta: 0.5 } })
    const chain = await readJson<Snaps>(
      await call('GET', `${DATA}/v1beta1/options/snapshots/aapl?feed=indicative`),
    )
    expect(Object.keys(chain.snapshots)).toHaveLength(20)
    expect(Object.keys(chain.snapshots)[0]?.startsWith('AAPL')).toBe(true)
  })

  it('serves latest stock trades keyed by symbol', async () => {
    const res = await call('GET', `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL,MSFT`)
    expect(res.status).toBe(200)
    const body = await readJson<Trades>(res)
    expect(body.currency).toBe('USD')
    expect(Object.keys(body.trades)).toEqual(['AAPL', 'MSFT'])
    const price = body.trades.AAPL!.p
    expect(Math.abs(price - 100)).toBeLessThan(1)
    expect(body.trades.AAPL).toEqual({ t: AT, x: 'V', p: price, s: 100, c: ['@'], i: 1, z: 'C' })
  })

  it('serves latest crypto trades keyed by slash symbol', async () => {
    const path = `${DATA}/v1beta3/crypto/us/latest/trades?symbols=BTC%2FUSD,ETHUSD`
    const body = await readJson<Trades>(await call('GET', path))
    expect(body.currency).toBeUndefined()
    expect(Object.keys(body.trades)).toEqual(['BTC/USD', 'ETH/USD'])
    const price = body.trades['BTC/USD']!.p
    expect(body.trades['BTC/USD']).toEqual({ t: AT, p: price, s: 0.01, tks: 'B', i: 1 })
  })

  it('rejects missing symbols', async () => {
    const res = await call('GET', `${DATA}/v2/stocks/trades/latest`)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      code: 40010001,
      message: 'symbols query parameter is required',
    })
  })

  it('serves news with a limit and optional symbols', async () => {
    const all = await readJson<News>(await call('GET', `${DATA}/v1beta1/news?limit=2`))
    expect(all.news).toHaveLength(2)
    expect(all.next_page_token).toBeNull()
    expect(all.news[0]).toMatchObject({ source: 'mock', symbols: ['SPY', 'QQQ'], created_at: AT })
    const apple = await readJson<News>(
      await call('GET', `${DATA}/v1beta1/news?symbols=AAPL&limit=5`),
    )
    expect(apple.news.map((n) => n.symbols)).toEqual([['AAPL']])
  })

  it('falls back to the default news limit for bad limits', async () => {
    for (const limit of ['zero', '0', '-1', '1.5', '']) {
      const body = await readJson<News>(await call('GET', `${DATA}/v1beta1/news?limit=${limit}`))
      expect(body.news).toHaveLength(8)
    }
    const unlimited = await readJson<News>(await call('GET', `${DATA}/v1beta1/news`))
    expect(unlimited.news).toHaveLength(8)
    const one = await readJson<News>(await call('GET', `${DATA}/v1beta1/news?limit=1`))
    expect(one.news).toHaveLength(1)
  })

  it('serves deterministic daily stock bars without weekends', async () => {
    const path = `${DATA}/v2/stocks/bars?symbols=AAPL&timeframe=1Day&start=2026-08-24&end=2026-08-30&limit=3`
    const first = await readJson<Bars>(await call('GET', path))
    const second = await readJson<Bars>(await call('GET', path))
    expect(first).toEqual(second)
    expect(first.currency).toBe('USD')
    expect(first.next_page_token).toBeNull()
    expect(first.bars.AAPL!.map((bar) => bar.t)).toEqual([
      '2026-08-26T00:00:00.000Z',
      '2026-08-27T00:00:00.000Z',
      '2026-08-28T00:00:00.000Z',
    ])
    expect(first.bars.AAPL![0]).toEqual({
      t: '2026-08-26T00:00:00.000Z',
      o: 856.13,
      h: 872.02,
      l: 853.3,
      c: 855.27,
      v: 964821,
      n: 9648,
      vw: 859.18,
    })
  })

  it('serves crypto bars for every day', async () => {
    const path = `${DATA}/v1beta3/crypto/us/bars?symbols=BTC%2FUSD&start=2026-08-24&end=2026-08-30`
    const body = await readJson<Bars>(await call('GET', path))
    expect(body.currency).toBeUndefined()
    expect(body.next_page_token).toBeNull()
    expect(body.bars['BTC/USD']!.map((bar) => bar.t.slice(0, 10))).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ])
  })

  it('serves stock and crypto snapshots', async () => {
    const stocks = await readJson<Record<string, Snapshot>>(
      await call('GET', `${DATA}/v2/stocks/snapshots?symbols=AAPL`),
    )
    const apple = stocks.AAPL!
    const price = apple.latestTrade.p
    expect(apple.latestTrade).toEqual({ t: AT, x: 'V', p: price, s: 100, c: ['@'], i: 1, z: 'C' })
    expect(apple.latestQuote).toEqual({
      t: AT,
      ax: 'V',
      ap: cents(price + 0.01),
      as: 1,
      bx: 'V',
      bp: cents(price - 0.01),
      bs: 1,
      c: ['R'],
      z: 'C',
    })
    expect(apple.dailyBar.t).toBe('2026-09-01T00:00:00.000Z')
    expect(apple.minuteBar).toEqual(apple.dailyBar)
    expect(apple.prevDailyBar.t).toBe('2026-08-31T00:00:00.000Z')
    expect(apple.dailyBar.o).toBe(apple.prevDailyBar.c)
    const crypto = await readJson<{ snapshots: Record<string, Snapshot> }>(
      await call('GET', `${DATA}/v1beta3/crypto/us/snapshots?symbols=BTCUSD`),
    )
    const btc = crypto.snapshots['BTC/USD']!
    expect(btc.latestTrade).toEqual({ t: AT, p: btc.latestTrade.p, s: 0.01, tks: 'B', i: 1 })
  })

  it('serves screeners', async () => {
    const stocks = await readJson<Movers>(
      await call('GET', `${DATA}/v1beta1/screener/stocks/movers?top=2`),
    )
    expect(stocks).toMatchObject({ market_type: 'stocks', last_updated: AT })
    expect(stocks.gainers.map((m) => m.symbol)).toEqual(['MSFT', 'AMD'])
    expect(stocks.losers).toHaveLength(2)
    const crypto = await readJson<Movers>(
      await call('GET', `${DATA}/v1beta1/screener/crypto/movers`),
    )
    expect(crypto).toMatchObject({ market_type: 'crypto', last_updated: AT })
    expect(crypto.gainers.map((m) => m.symbol)).toEqual([
      'DOGE/USD',
      'ETH/USD',
      'SOL/USD',
      'BTC/USD',
    ])
    const actives = await readJson<Actives>(
      await call('GET', `${DATA}/v1beta1/screener/stocks/most-actives?top=3`),
    )
    expect(actives).toEqual({
      most_actives: [
        { symbol: 'AMZN', volume: 45290559, trade_count: 905811 },
        { symbol: 'NVDA', volume: 41302102, trade_count: 826042 },
        { symbol: 'AAPL', volume: 39842955, trade_count: 796859 },
      ],
      last_updated: AT,
    })
  })

  it('returns 404 for unknown data endpoints', async () => {
    const res = await call('GET', `${DATA}/v2/stocks/quotes/latest?symbols=AAPL`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: 40410000, message: 'endpoint not found' })
  })
})

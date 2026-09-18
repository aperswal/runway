import { desc } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  DATA,
  accountJson,
  clockJson,
  db,
  fakeQueue,
  insertTrade,
  latestTradesJson,
  orderJson,
  positionJson,
  resetDb,
  seedFund,
  stubFetch,
  testEnv,
  type Route,
} from '../test/helpers'
import { snapshots, trades } from './db/schema'
import { buildDeps } from './deps'
import { decideExit, runCycle, toHeld } from './exits'

const queue = fakeQueue()
const base = buildDeps(testEnv({ POSTS: queue.queue }))
const deps = { db: base.db, alpaca: base.alpaca, postQueue: queue.queue }

describe('decideExit', () => {
  const trade = { stop: 90, target: 110 }
  it('holds between stop and target', () => expect(decideExit(trade, 100)).toBe('hold'))
  it('stops at or below stop', () => expect(decideExit(trade, 90)).toBe('stop'))
  it('takes profit at or above target', () => {
    expect(decideExit(trade, 110)).toBe('target')
    expect(decideExit(trade, 110.5)).toBe('target')
  })
})

describe('toHeld', () => {
  it('maps broker positions to stored positions', () => {
    expect(
      toHeld({
        symbol: 'AAPL',
        qty: 1,
        avg_entry_price: 2,
        current_price: 3,
        market_value: 4,
        unrealized_pl: 5,
        asset_class: 'us_equity',
      }),
    ).toEqual({ symbol: 'AAPL', qty: 1, marketValue: 4, currentPrice: 3, unrealizedPl: 5 })
  })
})

const closeRoutes = (symbol: string, id: string, price: string): Route[] => [
  {
    url: `${ALPACA}/v2/positions/${symbol}`,
    method: 'DELETE',
    body: orderJson({ id, symbol, status: 'accepted', filledAvgPrice: null, filledQty: null }),
  },
  { url: `${ALPACA}/v2/orders/${id}`, body: orderJson({ id, symbol, filledAvgPrice: price }) },
]

type HeldPosition = { symbol: string; currentPrice: number }

const marketRoutes = (open: boolean, positions: HeldPosition[]): Route[] => [
  { url: `${ALPACA}/v2/account`, body: accountJson({ equity: '1234', cash: '400' }) },
  { url: `${ALPACA}/v2/clock`, body: clockJson(open) },
  {
    url: `${ALPACA}/v2/positions`,
    body: positions.map((p) =>
      positionJson({ symbol: p.symbol, currentPrice: String(p.currentPrice) }),
    ),
  },
]

const statuses = async (): Promise<Record<string, string>> =>
  Object.fromEntries((await db.select().from(trades)).map((t) => [t.symbol, t.status]))

describe('runCycle', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
    queue.send.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('enforces stops and targets using prices already known from positions', async () => {
    const { calls } = stubFetch([
      ...marketRoutes(true, [
        { symbol: 'AAPL', currentPrice: 170 },
        { symbol: 'MSFT', currentPrice: 500 },
        { symbol: 'NVDA', currentPrice: 200 },
      ]),
      ...closeRoutes('AAPL', 'c1', '170'),
      ...closeRoutes('MSFT', 'c2', '500'),
    ])
    await insertTrade({ symbol: 'AAPL', stop: 180, target: 240 })
    await insertTrade({ symbol: 'MSFT', stop: 300, target: 400 })
    await insertTrade({ symbol: 'NVDA', stop: 100, target: 300 })
    await runCycle(deps)
    const [snapshot] = await db.select().from(snapshots).orderBy(desc(snapshots.id))
    expect(snapshot).toMatchObject({ equity: 1234, cash: 400 })
    expect(snapshot?.positions.map((p) => p.symbol)).toEqual(['AAPL', 'MSFT', 'NVDA'])
    expect(await statuses()).toEqual({ AAPL: 'closed', MSFT: 'closed', NVDA: 'open' })
    const rows = await db.select().from(trades)
    expect(rows.find((t) => t.symbol === 'AAPL')).toMatchObject({
      exitReason: 'stop',
      exitPrice: 170,
    })
    expect(rows.find((t) => t.symbol === 'MSFT')).toMatchObject({
      exitReason: 'target',
      exitPrice: 500,
    })
    expect(queue.send).toHaveBeenCalledTimes(2)
    expect(calls).toHaveLength(7)
  })

  it('sells flagged lots at the next tradable cycle regardless of stop and target', async () => {
    stubFetch([
      ...marketRoutes(true, [{ symbol: 'AAPL', currentPrice: 200 }]),
      ...closeRoutes('AAPL', 'c9', '200'),
    ])
    await insertTrade({ symbol: 'AAPL', stop: 100, target: 300, liquidate: true })
    await runCycle(deps)
    const rows = await db.select().from(trades)
    expect(rows[0]).toMatchObject({ status: 'closed', exitReason: 'operator liquidation' })
  })

  it('fetches a fresh price only for a trade that just filled this cycle', async () => {
    const { calls } = stubFetch([
      ...marketRoutes(true, [{ symbol: 'AAPL', currentPrice: 220 }]),
      {
        url: `${ALPACA}/v2/orders/o1`,
        body: orderJson({ id: 'o1', symbol: 'MSFT', filledAvgPrice: '250', filledQty: '1' }),
      },
      {
        url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=MSFT`,
        body: latestTradesJson({ MSFT: 260 }),
      },
    ])
    await insertTrade({ symbol: 'AAPL', stop: 180, target: 240 })
    await insertTrade({
      symbol: 'MSFT',
      status: 'pending',
      orderId: 'o1',
      stop: 200,
      target: 300,
    })
    await runCycle(deps)
    expect(await statuses()).toEqual({ AAPL: 'open', MSFT: 'open' })
    expect(queue.send).toHaveBeenCalledWith({ tradeId: expect.any(Number), kind: 'buy' })
    expect(calls).toHaveLength(5)
  })

  it('logs a symbol the broker has no price for at all', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { calls } = stubFetch([
      ...marketRoutes(true, []),
      { url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=TSLA`, body: latestTradesJson({}) },
    ])
    await insertTrade({
      symbol: 'TSLA',
      stop: 100,
      target: 300,
      openedAt: new Date().toISOString(),
    })
    await runCycle(deps)
    expect(await statuses()).toEqual({ TSLA: 'open' })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('no price for open trade'))
    expect(calls).toHaveLength(4)
  })

  it('reconciles before enforcing and skips stocks while the market is closed', async () => {
    const { calls } = stubFetch([
      ...marketRoutes(false, [
        { symbol: 'AAPL', currentPrice: 200 },
        { symbol: 'BTCUSD', currentPrice: 100 },
      ]),
      ...closeRoutes('BTCUSD', 'c1', '100'),
    ])
    await insertTrade({ symbol: 'AAPL', stop: 180, target: 240 })
    await insertTrade({ symbol: 'BTC/USD', assetClass: 'crypto', stop: 150, target: 300 })
    await insertTrade({ symbol: 'GONE', openedAt: '2026-08-01T00:00:00.000Z' })
    await runCycle(deps)
    expect(await statuses()).toEqual({ AAPL: 'open', 'BTC/USD': 'closed', GONE: 'closed' })
    expect(calls).toHaveLength(5)
  })

  it('prices only open trades, not pending ones', async () => {
    const { calls } = stubFetch([
      ...marketRoutes(true, [{ symbol: 'AAPL', currentPrice: 220 }]),
      { url: `${ALPACA}/v2/orders/o1`, body: orderJson({ id: 'o1', status: 'new' }) },
    ])
    await insertTrade({ symbol: 'AAPL', stop: 180, target: 240 })
    await insertTrade({ symbol: 'MSFT', status: 'pending', orderId: 'o1' })
    await runCycle(deps)
    expect(await statuses()).toEqual({ AAPL: 'open', MSFT: 'pending' })
    expect(calls).toHaveLength(4)
  })

  it('stops after the snapshot when nothing is enforceable', async () => {
    const { calls } = stubFetch(marketRoutes(false, []))
    await runCycle(deps)
    expect(await db.select().from(snapshots)).toHaveLength(1)
    expect(calls).toHaveLength(3)
  })

  it('isolates a failed exit from the other trades', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubFetch([
      ...marketRoutes(true, [
        { symbol: 'AAPL', currentPrice: 170 },
        { symbol: 'MSFT', currentPrice: 500 },
      ]),
      { url: `${ALPACA}/v2/positions/AAPL`, method: 'DELETE', status: 500, body: 'down' },
      ...closeRoutes('MSFT', 'c2', '500'),
    ])
    await insertTrade({ symbol: 'AAPL', stop: 180, target: 240 })
    await insertTrade({ symbol: 'MSFT', stop: 300, target: 400 })
    await runCycle(deps)
    expect(await statuses()).toEqual({ AAPL: 'open', MSFT: 'closed' })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"message":"exit failed"'))
  })
})

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  DATA,
  db,
  fakeQueue,
  insertTrade,
  jsonBody,
  latestTradesJson,
  orderJson,
  resetDb,
  seedFund,
  stubFetch,
  testEnv,
  type Route,
  stubDb,
} from '../test/helpers'
import type { Account } from './alpaca'
import { trades } from './db/schema'
import { buildDeps } from './deps'
import { StateError } from './errors'
import {
  activate,
  canExitNow,
  activeTrades,
  closePositionInput,
  closeTrade,
  finalize,
  findOpenTrade,
  requirePrice,
  setStatus,
} from './trades'
import { adjustExits, adjustExitsInput, ratchetStop } from './exit-adjust'

const queue = fakeQueue()
const base = buildDeps(testEnv({ POSTS: queue.queue }))
const deps = { db: base.db, alpaca: base.alpaca, postQueue: queue.queue }
const account: Account = { equity: 1000, cash: 800, daytrade_count: 0, pattern_day_trader: false }

const closeRoutes = (filledAvgPrice: string | null = '220'): Route[] => [
  {
    url: `${ALPACA}/v2/positions/AAPL`,
    method: 'DELETE',
    body: orderJson({ id: 'close-1', status: 'accepted', filledAvgPrice: null, filledQty: null }),
  },
  { url: `${ALPACA}/v2/orders/close-1`, body: orderJson({ id: 'close-1', filledAvgPrice }) },
]

const tradeById = async (id: number): Promise<Record<string, unknown> | undefined> =>
  (await db.select().from(trades).where(eq(trades.id, id)))[0]

describe('trade inputs', () => {
  it('trims close reasons', () => {
    expect(closePositionInput.parse({ reason: ' done ' })).toEqual({ reason: 'done' })
    expect(closePositionInput.safeParse({ reason: ' ' }).success).toBe(false)
  })
  it('requires at least one exit adjustment', () => {
    expect(adjustExitsInput.safeParse({}).error?.issues[0]?.message).toBe(
      'give a stop, a target, a trailing percentage, or several',
    )
    expect(adjustExitsInput.safeParse({ stop: 1 }).success).toBe(true)
    expect(adjustExitsInput.safeParse({ target: 1 }).success).toBe(true)
  })
})

describe('trades', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
    queue.send.mockClear()
    queue.send.mockImplementation(() => Promise.resolve())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('finds open trades and prices', async () => {
    const trade = await insertTrade()
    await insertTrade({ symbol: 'MSFT', status: 'pending' })
    expect((await findOpenTrade(db, 'AAPL')).id).toBe(trade.id)
    expect((await findOpenTrade(db, 'AAPL', 'social')).id).toBe(trade.id)
    await expect(findOpenTrade(db, 'MSFT')).rejects.toThrow('no open position in MSFT')
    await expect(findOpenTrade(db, 'AAPL', 'ghost')).rejects.toThrow(
      'no open position in AAPL for ghost',
    )
    expect((await activeTrades(db)).map((t) => t.symbol)).toEqual(['AAPL', 'MSFT'])
    expect(requirePrice({ AAPL: 1 }, 'AAPL')).toBe(1)
    expect(() => requirePrice({}, 'AAPL')).toThrow(StateError)
  })

  it('activates only pending trades and defaults missing fill data', async () => {
    const pending = await insertTrade({ status: 'pending', qty: 0 })
    const fill = {
      id: 'o',
      symbol: 'AAPL',
      status: 'filled',
      filled_avg_price: null,
      filled_qty: null,
    }
    const trade = await activate(deps, pending.id, fill)
    expect(trade).toMatchObject({ status: 'open', qty: 0, entryPrice: 0, notional: 0 })
    const other = await insertTrade({ status: 'pending', symbol: 'MSFT', qty: 0 })
    const priced = await activate(deps, other.id, { ...fill, filled_avg_price: 10, filled_qty: 2 })
    expect(priced).toMatchObject({ status: 'open', qty: 2, entryPrice: 10, notional: 20 })
    await expect(activate(deps, pending.id, fill)).rejects.toThrow(
      `trade ${pending.id} was not pending`,
    )
  })

  it('closes a position and records the fill price', async () => {
    const trade = await insertTrade()
    stubFetch(closeRoutes())
    const closed = await closeTrade(deps, trade, {
      reason: 'thesis broke',
      account,
      marketOpen: true,
      price: 210,
    })
    expect(closed).toMatchObject({
      status: 'closed',
      exitPrice: 220,
      exitReason: 'thesis broke',
      closeOrderId: 'close-1',
    })
    expect(closed.closedAt).toMatch(/Z$/)
    expect(queue.send).toHaveBeenCalledWith({ tradeId: trade.id, kind: 'sell' })
  })

  it('takes partial profit by splitting the lot and selling the piece', async () => {
    const trade = await insertTrade({ qty: 0.5, notional: 100 })
    const { calls } = stubFetch([
      {
        url: `${ALPACA}/v2/orders`,
        method: 'POST',
        body: orderJson({ id: 'sell-1', status: 'accepted', filledAvgPrice: null }),
      },
      {
        url: `${ALPACA}/v2/orders/sell-1`,
        body: orderJson({ id: 'sell-1', filledAvgPrice: '210' }),
      },
    ])
    const piece = await closeTrade(
      deps,
      trade,
      { reason: 'half off at +1R', account, marketOpen: true, price: 210 },
      0.5,
    )
    expect(piece).toMatchObject({
      status: 'closed',
      qty: 0.25,
      notional: 50,
      exitPrice: 210,
      exitReason: 'half off at +1R',
      closeOrderId: 'sell-1',
    })
    expect(piece.id).not.toBe(trade.id)
    expect(await tradeById(trade.id)).toMatchObject({ status: 'open', qty: 0.25, notional: 50 })
    expect(jsonBody(calls[0])).toMatchObject({ symbol: 'AAPL', qty: '0.25', side: 'sell' })
    expect(queue.send).toHaveBeenCalledWith({ tradeId: piece.id, kind: 'sell' })
  })

  it('falls back to the entry price for a partial fill without an average and reports a lost record', async () => {
    const trade = await insertTrade({ qty: 0.5, notional: 100, entryPrice: 200 })
    const routes = () => [
      {
        url: `${ALPACA}/v2/orders`,
        method: 'POST',
        body: orderJson({ id: 'sell-3', status: 'accepted', filledAvgPrice: null }),
      },
      {
        url: `${ALPACA}/v2/orders/sell-3`,
        body: orderJson({ id: 'sell-3', filledAvgPrice: null }),
      },
    ]
    stubFetch(routes())
    const exit = { reason: 'trim', account, marketOpen: true, price: 210 }
    const piece = await closeTrade(deps, trade, exit, 0.5)
    expect(piece.exitPrice).toBe(200)
    stubFetch(routes())
    const rest = { ...trade, qty: 0.25, notional: 50 }
    await expect(closeTrade({ ...deps, db: stubDb([[]]) }, rest, exit, 0.5)).rejects.toThrow(
      `could not record the partial sale of trade ${trade.id}`,
    )
  })

  it('rounds partial sales to whole shares and contracts and refuses empty or full pieces', async () => {
    const whole = await insertTrade({ qty: 3 })
    const exit = { reason: 'trim', account, marketOpen: true, price: 210 }
    await expect(closeTrade(deps, whole, exit, 0.2)).rejects.toThrow('cannot sell 0.2 of 3 AAPL')
    const option = await insertTrade({ symbol: 'AAPL260918C00190000', qty: 1 })
    await expect(closeTrade(deps, option, exit, 0.5)).rejects.toThrow(
      'cannot sell 0.5 of 1 AAPL260918C00190000',
    )
    stubFetch([
      {
        url: `${ALPACA}/v2/orders`,
        method: 'POST',
        body: orderJson({ id: 'sell-2', status: 'accepted', filledAvgPrice: null }),
      },
      {
        url: `${ALPACA}/v2/orders/sell-2`,
        body: orderJson({ id: 'sell-2', filledAvgPrice: '210' }),
      },
    ])
    const piece = await closeTrade(deps, whole, exit, 0.5)
    expect(piece.qty).toBe(1)
    expect(await tradeById(whole.id)).toMatchObject({ qty: 2 })
  })

  it('sells only its own lot when another fund holds the same symbol', async () => {
    await seedFund({ id: 'quant', name: 'Quant' })
    const mine = await insertTrade({ qty: 0.4 })
    await insertTrade({ fund: 'quant', symbol: 'AAPL', qty: 1 })
    const { calls } = stubFetch([
      {
        url: `${ALPACA}/v2/orders`,
        method: 'POST',
        body: orderJson({ id: 'sell-1', status: 'accepted', filledAvgPrice: null }),
      },
      {
        url: `${ALPACA}/v2/orders/sell-1`,
        body: orderJson({ id: 'sell-1', filledAvgPrice: '210' }),
      },
    ])
    const closed = await closeTrade(deps, mine, {
      reason: 'target',
      account,
      marketOpen: true,
      price: 210,
    })
    expect(closed).toMatchObject({ status: 'closed', exitPrice: 210, closeOrderId: 'sell-1' })
    expect(jsonBody(calls[0])).toEqual({
      symbol: 'AAPL',
      qty: '0.4',
      side: 'sell',
      type: 'market',
      time_in_force: 'day',
      extended_hours: false,
    })
    expect((await activeTrades(db)).map((t) => t.fund)).toEqual(['quant'])
  })

  it('sells only its lot while another fund is still closing its own', async () => {
    await seedFund({ id: 'quant', name: 'Quant' })
    const mine = await insertTrade({ qty: 0.4 })
    await insertTrade({ fund: 'quant', symbol: 'AAPL', status: 'closing', exitReason: 'stop' })
    const { calls } = stubFetch([
      {
        url: `${ALPACA}/v2/orders`,
        method: 'POST',
        body: orderJson({ id: 's2', filledAvgPrice: '210' }),
      },
    ])
    expect(
      (
        await closeTrade(deps, mine, {
          reason: 'target',
          account,
          marketOpen: true,
          price: 210,
        })
      ).exitPrice,
    ).toBe(210)
    expect(calls.map((c) => c.method)).toEqual(['POST'])
  })

  it('closes the whole broker position when the other lot is already closed', async () => {
    await seedFund({ id: 'quant', name: 'Quant' })
    const mine = await insertTrade()
    await insertTrade({
      fund: 'quant',
      symbol: 'AAPL',
      status: 'closed',
      closedAt: '2026-09-01T00:00:00.000Z',
    })
    await insertTrade({ fund: 'quant', symbol: 'MSFT' })
    const { calls } = stubFetch(closeRoutes())
    expect(
      (
        await closeTrade(deps, mine, {
          reason: 'stop',
          account,
          marketOpen: true,
          price: 210,
        })
      ).status,
    ).toBe('closed')
    expect(calls[0]).toMatchObject({ method: 'DELETE' })
  })

  it('sells whole-share lots after hours with a marketable extended limit order', async () => {
    const trade = await insertTrade({ qty: 2 })
    const { calls } = stubFetch([
      {
        url: `${ALPACA}/v2/orders`,
        method: 'POST',
        body: orderJson({ id: 'x1', status: 'accepted', filledAvgPrice: null, filledQty: null }),
      },
      { url: `${ALPACA}/v2/orders/x1`, body: orderJson({ id: 'x1', filledAvgPrice: '208.9' }) },
    ])
    const closed = await closeTrade(deps, trade, {
      reason: 'stop',
      account,
      marketOpen: false,
      price: 210.004,
    })
    expect(closed).toMatchObject({ status: 'closed', exitPrice: 208.9 })
    expect(jsonBody(calls[0])).toEqual({
      symbol: 'AAPL',
      qty: '2',
      side: 'sell',
      type: 'limit',
      limit_price: '208.95',
      time_in_force: 'day',
      extended_hours: true,
    })
  })

  it('refuses to sell fractional lots and options after hours, but sells crypto any time', async () => {
    const fractional = await insertTrade({ qty: 0.5 })
    const { calls } = stubFetch([])
    await expect(
      closeTrade(deps, fractional, { reason: 'stop', account, marketOpen: false, price: 1 }),
    ).rejects.toThrow('can only be sold in the regular session')
    expect(calls).toHaveLength(0)
    expect(await tradeById(fractional.id)).toMatchObject({ status: 'open' })
    expect(canExitNow({ symbol: 'AAPL260116C00190000', qty: 1 }, false)).toBe(false)
    expect(canExitNow({ symbol: 'AAPL260116C00190000', qty: 1 }, true)).toBe(true)
    expect(canExitNow({ symbol: 'BTC/USD', qty: 0.01 }, false)).toBe(true)
    expect(canExitNow({ symbol: 'AAPL', qty: 3 }, false)).toBe(true)
    expect(canExitNow({ symbol: 'AAPL', qty: 0.3 }, false)).toBe(false)
  })

  it('falls back to the entry price when the fill has no average', async () => {
    const trade = await insertTrade()
    stubFetch(closeRoutes(null))
    expect(
      (
        await closeTrade(deps, trade, {
          reason: 'stop',
          account,
          marketOpen: true,
          price: 210,
        })
      ).exitPrice,
    ).toBe(200)
  })

  it('reverts to open when the close order cannot be submitted', async () => {
    const trade = await insertTrade()
    stubFetch([{ url: `${ALPACA}/v2/positions/AAPL`, method: 'DELETE', status: 503, body: 'busy' }])
    await expect(
      closeTrade(deps, trade, { reason: 'stop', account, marketOpen: true, price: 210 }),
    ).rejects.toThrow('alpaca 503')
    expect(await tradeById(trade.id)).toMatchObject({ status: 'open', exitReason: null })
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('refuses a close that would break the day trade rule', async () => {
    const trade = await insertTrade({ openedAt: new Date().toISOString() })
    const { calls } = stubFetch([])
    const limited = { ...account, daytrade_count: 3 }
    await expect(
      closeTrade(deps, trade, { reason: 'stop', account: limited, marketOpen: true, price: 210 }),
    ).rejects.toThrow('day_trade_limit')
    expect(calls).toHaveLength(0)
    expect(await tradeById(trade.id)).toMatchObject({ status: 'open' })
  })

  it('finalizes closing trades and guards status transitions', async () => {
    const trade = await insertTrade({ status: 'closing', exitReason: 'target' })
    const closed = await finalize(deps, trade.id, 230)
    expect(closed).toMatchObject({ status: 'closed', exitPrice: 230 })
    await expect(setStatus(db, trade.id, 'closing', { status: 'open' })).rejects.toThrow(
      `trade ${trade.id} is no longer closing`,
    )
  })

  it('logs and continues when the post queue is down', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    queue.send.mockRejectedValue(new TypeError('queue down'))
    const trade = await insertTrade({ status: 'closing' })
    expect((await finalize(deps, trade.id, 1)).status).toBe('closed')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('post enqueue failed'))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('queue down'))
  })

  it('adjusts exits around the current price', async () => {
    const trade = await insertTrade()
    stubFetch([
      {
        url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`,
        body: latestTradesJson({ AAPL: 210 }),
      },
    ])
    expect(await adjustExits(deps, trade, { stop: 190 })).toMatchObject({ stop: 190, target: 240 })
    expect(await adjustExits(deps, trade, { target: 260 })).toMatchObject({
      stop: 180,
      target: 260,
    })
    expect(await adjustExits(deps, trade, { stop: 200, target: 250 })).toMatchObject({
      stop: 200,
      target: 250,
    })
    await expect(adjustExits(deps, trade, { target: 205 })).rejects.toThrow('bad_target')
  })

  it('sets, keeps and clears the trailing stop through adjust_exits', async () => {
    const trade = await insertTrade({ stop: 180, target: 240 })
    const priced = (): void => {
      stubFetch([
        {
          url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`,
          body: latestTradesJson({ AAPL: 200 }),
        },
      ])
    }
    priced()
    const trailing = await adjustExits(deps, trade, { trailPct: 3 })
    expect(trailing).toMatchObject({ stop: 180, target: 240, trailPct: 3 })
    priced()
    const kept = await adjustExits(deps, trailing, { stop: 185 })
    expect(kept).toMatchObject({ stop: 185, trailPct: 3 })
    priced()
    const cleared = await adjustExits(deps, kept, { trailPct: null })
    expect(cleared.trailPct).toBeNull()
  })

  it('ratchets a trailing stop up with the price and never down', async () => {
    const trade = await insertTrade({ stop: 180, target: 300, trailPct: 5 })
    const raised = await ratchetStop(db, trade, 220)
    expect(raised.stop).toBe(209)
    const same = await ratchetStop(db, raised, 200)
    expect(same.stop).toBe(209)
    const plain = await insertTrade({ symbol: 'MSFT', stop: 180, target: 300 })
    expect(await ratchetStop(db, plain, 500)).toEqual(plain)
  })

  it('needs a price to adjust exits', async () => {
    const trade = await insertTrade()
    stubFetch([
      { url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`, body: latestTradesJson({}) },
    ])
    await expect(adjustExits(deps, trade, { stop: 1 })).rejects.toThrow(StateError)
  })
})

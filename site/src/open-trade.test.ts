import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  DATA,
  accountJson,
  assetJson,
  clockJson,
  db,
  fakeQueue,
  insertTrade,
  jsonBody,
  latestTradesJson,
  orderJson,
  resetDb,
  seedFund,
  stubDb,
  stubFetch,
  testEnv,
  type Route,
} from '../test/helpers'
import { trades } from './db/schema'
import { buildDeps } from './deps'
import { ExternalServiceError, StateError } from './errors'
import { GuardrailError } from './guardrails'
import { cancelQueued, findQueuedTrade, openPositionInput, openTrade } from './open-trade'
import { activeTrades } from './trades'

const queue = fakeQueue()
const base = buildDeps(testEnv({ POSTS: queue.queue }))
const deps = { db: base.db, alpaca: base.alpaca, postQueue: queue.queue }

const input = {
  fund: 'social',
  symbol: 'AAPL',
  notional: 100,
  stop: 180,
  target: 240,
  horizon: '2 weeks',
  reason: 'Review velocity is accelerating',
}
const limitInput = { ...input, notional: undefined, qty: 1, limit: 190 }

const openRoutes = (marketOpen = true): Route[] => [
  { url: `${ALPACA}/v2/account`, body: accountJson() },
  { url: `${ALPACA}/v2/clock`, body: clockJson(marketOpen) },
  { url: `${ALPACA}/v2/assets/AAPL`, body: assetJson() },
  {
    url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`,
    body: latestTradesJson({ AAPL: 200 }),
  },
  {
    url: `${ALPACA}/v2/orders`,
    method: 'POST',
    body: orderJson({ status: 'accepted', filledAvgPrice: null, filledQty: null }),
  },
  {
    url: `${ALPACA}/v2/orders/ord-1`,
    body: orderJson({ filledAvgPrice: '201', filledQty: '0.4975' }),
  },
]

describe('openPositionInput', () => {
  it('refuses new positions while the book is being liquidated', async () => {
    await insertTrade({ symbol: 'MSFT', liquidate: true })
    await expect(
      openTrade(deps, {
        fund: 'social',
        symbol: 'AAPL',
        notional: 50,
        stop: 90,
        target: 110,
        horizon: '2 weeks',
        reason: 'why',
      }),
    ).rejects.toThrow('the operator is liquidating the book')
  })

  it('stores a trailing stop percentage when given', () => {
    const parsed = openPositionInput.parse({
      fund: 'social',
      symbol: 'aapl',
      notional: 50,
      stop: 90,
      target: 110,
      trailPct: 3,
      horizon: '2 weeks',
      reason: 'why',
    })
    expect(parsed).toMatchObject({ symbol: 'AAPL', trailPct: 3 })
    expect(
      openPositionInput.safeParse({
        fund: 'social',
        symbol: 'AAPL',
        notional: 50,
        stop: 90,
        target: 110,
        trailPct: 80,
        horizon: '2 weeks',
        reason: 'why',
      }).success,
    ).toBe(false)
  })

  it('normalizes symbols and trims text', () => {
    expect(openPositionInput.parse({ ...input, symbol: ' btc/usd ' }).symbol).toBe('BTC/USD')
    expect(
      openPositionInput.safeParse({ ...input, symbol: 'TOO-LONG-SYMBOL' }).error?.issues[0]
        ?.message,
    ).toContain('symbol like AAPL or BTC/USD')
    const parsed = openPositionInput.parse({ ...input, horizon: ' 2 weeks ', reason: ' r ' })
    expect(parsed).toMatchObject({ horizon: '2 weeks', reason: 'r' })
    expect(openPositionInput.safeParse({ ...input, horizon: ' ' }).success).toBe(false)
    const ok = (symbol: string): boolean =>
      openPositionInput.safeParse({ ...input, symbol }).success
    expect(ok('AAPL260116C00190000')).toBe(true)
    expect(ok('spy261218p00450500')).toBe(true)
    for (const bad of [
      'AAPLXYZ260116C00190000',
      '1AAPL260116C00190000',
      'AAPL26011C00190000',
      'AAPL260116X00190000',
      'AAPL260116C0019000',
      'AAPLABCDEFC00190000',
      'AAPL260116C001900001',
      'AAPL.260116C00190000',
      'TOOLONGSYMBOL',
    ]) {
      expect(ok(bad)).toBe(false)
    }
  })
  it('takes notional or qty, never both, and limits only with qty', () => {
    expect(openPositionInput.parse(limitInput)).toMatchObject({ qty: 1, limit: 190 })
    expect(openPositionInput.parse({ ...limitInput, limit: undefined })).toMatchObject({ qty: 1 })
    expect(openPositionInput.safeParse({ ...input, qty: 1 }).success).toBe(false)
    expect(openPositionInput.safeParse({ ...input, notional: undefined }).success).toBe(false)
    expect(openPositionInput.safeParse({ ...input, limit: 190 }).success).toBe(false)
  })
})

describe('openTrade', () => {
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

  it('opens a market position end to end', async () => {
    const { calls } = stubFetch(openRoutes())
    await insertTrade({ symbol: 'MSFT', notional: 100 })
    const trade = await openTrade(deps, input)
    expect(trade).toMatchObject({
      symbol: 'AAPL',
      status: 'open',
      assetClass: 'us_equity',
      qty: 0.4975,
      entryPrice: 201,
      orderId: 'ord-1',
      notional: 0.4975 * 201,
      limitPrice: null,
      expiresAt: null,
    })
    expect(queue.send).toHaveBeenCalledWith({ tradeId: trade.id, kind: 'buy' })
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'GET', 'GET', 'POST', 'GET'])
  })

  it('buys a whole quantity at market', async () => {
    const routes = openRoutes()
    routes[5] = { url: `${ALPACA}/v2/orders/ord-1`, body: orderJson({ filledQty: '1' }) }
    const { calls } = stubFetch(routes)
    const trade = await openTrade(deps, { ...input, notional: undefined, qty: 1 })
    expect(trade).toMatchObject({ status: 'open', qty: 1, entryPrice: 200, notional: 200 })
    expect(jsonBody(calls[4])).toMatchObject({ qty: '1', type: 'market' })
  })

  it('queues a limit order and leaves it pending until it fills', async () => {
    const routes = openRoutes(false)
    routes[4] = { url: `${ALPACA}/v2/orders`, method: 'POST', body: orderJson({ status: 'new' }) }
    const { calls } = stubFetch(routes)
    const trade = await openTrade(deps, limitInput)
    expect(trade).toMatchObject({
      status: 'pending',
      orderId: 'ord-1',
      qty: 1,
      limitPrice: 190,
      entryPrice: 190,
      notional: 190,
    })
    expect(jsonBody(calls[4])).toEqual({
      symbol: 'AAPL',
      qty: '1',
      limit_price: '190.00',
      side: 'buy',
      type: 'limit',
      time_in_force: 'day',
      extended_hours: true,
    })
    const hours = (new Date(trade.expiresAt ?? '').getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(23.9)
    expect(hours).toBeLessThanOrEqual(24)
    expect(calls).toHaveLength(5)
    expect(queue.send).not.toHaveBeenCalled()
    expect(await activeTrades(db)).toMatchObject([{ status: 'pending', symbol: 'AAPL' }])
  })

  it('keeps a queued order alive for the requested hours', async () => {
    const routes = openRoutes(false)
    routes[4] = { url: `${ALPACA}/v2/orders`, method: 'POST', body: orderJson({ status: 'new' }) }
    stubFetch(routes)
    const trade = await openTrade(deps, { ...limitInput, aliveHours: 72 })
    const hours = (new Date(trade.expiresAt ?? '').getTime() - Date.now()) / 3_600_000
    expect(hours).toBeGreaterThan(71.9)
    expect(openPositionInput.safeParse({ ...limitInput, aliveHours: 169 }).success).toBe(false)
  })

  it('activates a limit order that fills at once', async () => {
    const routes = openRoutes()
    routes[4] = {
      url: `${ALPACA}/v2/orders`,
      method: 'POST',
      body: orderJson({ filledAvgPrice: '189', filledQty: '1' }),
    }
    stubFetch(routes)
    const trade = await openTrade(deps, limitInput)
    expect(trade).toMatchObject({ status: 'open', entryPrice: 189, qty: 1 })
    expect(queue.send).toHaveBeenCalledTimes(1)
  })

  it('refuses fractional limit orders while the market is closed and brackets the limit', async () => {
    stubFetch(openRoutes(false))
    await expect(openTrade(deps, { ...limitInput, qty: 0.5 })).rejects.toThrow('market_closed')
    await expect(openTrade(deps, input)).rejects.toThrow('market_closed')
    await expect(openTrade(deps, { ...input, notional: undefined, qty: 1 })).rejects.toThrow(
      'market_closed',
    )
    await expect(openTrade(deps, { ...limitInput, stop: 195 })).rejects.toThrow('bad_stop')
    expect(await activeTrades(db)).toEqual([])
  })

  it('buys option contracts by premium times the multiplier and never queues them', async () => {
    const contract = 'AAPL260116C00190000'
    const routes = (marketOpen: boolean): Route[] => [
      { url: `${ALPACA}/v2/account`, body: accountJson() },
      { url: `${ALPACA}/v2/clock`, body: clockJson(marketOpen) },
      {
        url: `${ALPACA}/v2/options/contracts/${contract}`,
        body: { symbol: contract, tradable: true, status: 'active' },
      },
      {
        url: `${DATA}/v1beta1/options/trades/latest?symbols=${contract}`,
        body: latestTradesJson({ [contract]: 2 }),
      },
      {
        url: `${ALPACA}/v2/orders`,
        method: 'POST',
        body: orderJson({ symbol: contract, filledAvgPrice: '2.1', filledQty: '1' }),
      },
    ]
    stubFetch(routes(true))
    const option = { ...input, symbol: contract, notional: undefined, qty: 1, stop: 1, target: 4 }
    const trade = await openTrade(deps, option)
    expect(trade).toMatchObject({
      status: 'open',
      assetClass: 'us_option',
      qty: 1,
      entryPrice: 2.1,
      notional: 210,
    })
    await db.delete(trades)
    await expect(openTrade(deps, { ...option, qty: 2 })).rejects.toThrow('too_large')
    await expect(openTrade(deps, { ...option, qty: 0.5 })).rejects.toThrow('not_fractionable')
    vi.unstubAllGlobals()
    stubFetch(routes(false))
    await expect(openTrade(deps, { ...option, limit: 2 })).rejects.toThrow('market_closed')
  })

  it('counts only the same fund as deployed', async () => {
    stubFetch(openRoutes())
    await seedFund({ id: 'supply', name: 'Supply' })
    await insertTrade({ fund: 'supply', symbol: 'MSFT', notional: 450 })
    expect((await openTrade(deps, input)).status).toBe('open')
  })

  it('refuses a second lot in a symbol the fund already holds, but lets another fund in', async () => {
    stubFetch(openRoutes())
    await insertTrade({ symbol: 'AAPL' })
    await expect(openTrade(deps, input)).rejects.toThrow(
      'already_open: AAPL is already held by this fund; adjust or close that lot instead',
    )
    await seedFund({ id: 'quant', name: 'Quant' })
    const lot = await openTrade(deps, { ...input, fund: 'quant' })
    expect(lot).toMatchObject({ fund: 'quant', symbol: 'AAPL', status: 'open' })
    expect((await activeTrades(db)).map((t) => t.fund)).toEqual(['social', 'quant'])
  })

  it('leaves no row behind when the guardrails reject the order', async () => {
    stubFetch(openRoutes())
    await insertTrade({ symbol: 'MSFT', notional: 450 })
    await expect(openTrade(deps, input)).rejects.toThrow('fund_cap: Social signal fund has $50.00')
    await db.delete(trades)
    await expect(openTrade(deps, { ...input, notional: 900 })).rejects.toThrow(GuardrailError)
    await expect(openTrade(deps, { ...input, stop: 250 })).rejects.toThrow('bad_stop')
    expect(await activeTrades(db)).toEqual([])
  })

  it('applies the crypto minimum', async () => {
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson() },
      { url: `${ALPACA}/v2/clock`, body: clockJson(true) },
      {
        url: `${ALPACA}/v2/assets/BTC%2FUSD`,
        body: assetJson({ symbol: 'BTC/USD', class: 'crypto' }),
      },
      {
        url: `${DATA}/v1beta3/crypto/us/latest/trades?symbols=BTC%2FUSD`,
        body: latestTradesJson({ 'BTC/USD': 100 }),
      },
    ])
    const crypto = { ...input, symbol: 'BTC/USD', notional: 5, stop: 90, target: 120 }
    await expect(openTrade(deps, crypto)).rejects.toThrow('minimum order for BTC/USD is $10')
  })

  it('needs a price before ordering', async () => {
    const routes = openRoutes()
    routes[3] = { ...routes[3], body: latestTradesJson({}) } as Route
    stubFetch(routes)
    await expect(openTrade(deps, input)).rejects.toThrow('no recent price for AAPL')
  })

  it('removes the pending row when the order submission fails', async () => {
    const routes = openRoutes()
    routes[4] = { url: `${ALPACA}/v2/orders`, method: 'POST', status: 500, body: 'down' }
    stubFetch(routes)
    await expect(openTrade(deps, input)).rejects.toThrow(ExternalServiceError)
    expect(await db.select().from(trades)).toEqual([])
    expect(queue.send).not.toHaveBeenCalled()
  })

  it('keeps the pending row when the fill never comes', async () => {
    const routes = openRoutes()
    routes[5] = { url: `${ALPACA}/v2/orders/ord-1`, body: orderJson({ status: 'rejected' }) }
    stubFetch(routes)
    await expect(openTrade(deps, input)).rejects.toThrow('order ord-1 rejected')
    expect(await activeTrades(db)).toMatchObject([{ status: 'pending', orderId: 'ord-1' }])
  })

  it('reports a pending insert that returned nothing', async () => {
    stubFetch(openRoutes())
    const fund = { id: 'social', name: 'Social', share: 0.5, status: 'active' }
    const fake = stubDb([[fund], [], []])
    await expect(openTrade({ ...deps, db: fake }, input)).rejects.toThrow(
      'trade insert returned nothing',
    )
  })
})

describe('cancelQueued', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
    queue.send.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('finds queued orders only when they were submitted', async () => {
    await insertTrade({ symbol: 'AAPL', status: 'pending', orderId: 'o1' })
    await insertTrade({ symbol: 'MSFT', status: 'pending', orderId: null })
    await insertTrade({ symbol: 'NVDA', status: 'open', orderId: 'o3' })
    expect((await findQueuedTrade(db, 'AAPL')).orderId).toBe('o1')
    expect((await findQueuedTrade(db, 'AAPL', 'social')).orderId).toBe('o1')
    await expect(findQueuedTrade(db, 'MSFT')).rejects.toThrow('no queued order in MSFT')
    await expect(findQueuedTrade(db, 'AAPL', 'ghost')).rejects.toThrow(
      'no queued order in AAPL for ghost',
    )
    await expect(findQueuedTrade(db, 'NVDA')).rejects.toThrow(StateError)
  })

  it('cancels at the broker and marks the trade cancelled', async () => {
    const { calls } = stubFetch([
      { url: `${ALPACA}/v2/orders/o1`, body: orderJson({ id: 'o1', status: 'new' }) },
      { url: `${ALPACA}/v2/orders/o1`, method: 'DELETE', status: 204, body: '' },
    ])
    await insertTrade({ status: 'pending', orderId: 'o1' })
    const trade = await findQueuedTrade(db, 'AAPL')
    const cancelled = await cancelQueued(deps, trade, 'changed mind')
    expect(cancelled).toMatchObject({ status: 'cancelled', exitReason: 'changed mind' })
    expect(cancelled.closedAt).toMatch(/Z$/)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE'])
    expect(await activeTrades(db)).toEqual([])
  })

  it('activates instead when the order already filled', async () => {
    stubFetch([
      { url: `${ALPACA}/v2/orders/o1`, body: orderJson({ id: 'o1', filledAvgPrice: '190' }) },
    ])
    await insertTrade({ status: 'pending', orderId: 'o1', qty: 1 })
    const trade = await findQueuedTrade(db, 'AAPL')
    await expect(cancelQueued(deps, trade, 'late')).rejects.toThrow(
      'AAPL already filled; it is an open position now',
    )
    expect(await activeTrades(db)).toMatchObject([{ status: 'open', entryPrice: 190 }])
    expect(queue.send).toHaveBeenCalledWith({ tradeId: trade.id, kind: 'buy' })
  })

  it('leaves the order pending when the broker refuses the cancel', async () => {
    stubFetch([
      { url: `${ALPACA}/v2/orders/o1`, body: orderJson({ id: 'o1', status: 'new' }) },
      { url: `${ALPACA}/v2/orders/o1`, method: 'DELETE', status: 422, body: 'nope' },
    ])
    await insertTrade({ status: 'pending', orderId: 'o1' })
    const trade = await findQueuedTrade(db, 'AAPL')
    await expect(cancelQueued(deps, trade, 'x')).rejects.toThrow(ExternalServiceError)
    expect(await activeTrades(db)).toMatchObject([{ status: 'pending' }])
  })
})

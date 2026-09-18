import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  db,
  fakeQueue,
  insertTrade,
  orderJson,
  resetDb,
  seedFund,
  stubFetch,
  testEnv,
  jsonBody,
} from '../test/helpers'
import { trades, type Trade } from './db/schema'
import { buildDeps } from './deps'
import { MISSING_AT_BROKER, reconcileTrade } from './reconcile'

const queue = fakeQueue()
const base = buildDeps(testEnv({ POSTS: queue.queue }))
const deps = { db: base.db, alpaca: base.alpaca, postQueue: queue.queue }
const MINUTE = 60_000

const minutesAgo = (n: number): string => new Date(Date.now() - n * MINUTE).toISOString()

const reload = async (trade: Trade): Promise<Trade | undefined> =>
  (await db.select().from(trades).where(eq(trades.id, trade.id)))[0]

const orderRoute = (id: string, status: string, filledAvgPrice: string | null = '220') => ({
  url: `${ALPACA}/v2/orders/${id}`,
  body: orderJson({ id, status, filledAvgPrice }),
})

describe('reconcileTrade', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
    queue.send.mockClear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('pending', () => {
    it('deletes unsubmitted trades once the five minute grace period has passed', async () => {
      const openedAt = '2026-09-01T12:00:00.000Z'
      const stale = await insertTrade({ status: 'pending', openedAt })
      const fresh = await insertTrade({ status: 'pending', symbol: 'MSFT', openedAt })
      await reconcileTrade(deps, stale, new Set(), new Date('2026-09-01T12:05:00.001Z'))
      await reconcileTrade(deps, fresh, new Set(), new Date('2026-09-01T12:05:00.000Z'))
      expect(await reload(stale)).toBeUndefined()
      expect((await reload(fresh))?.status).toBe('pending')
    })

    it('activates filled orders', async () => {
      stubFetch([orderRoute('o1', 'filled', '205')])
      const trade = await insertTrade({ status: 'pending', orderId: 'o1', qty: 0 })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect(await reload(trade)).toMatchObject({ status: 'open', entryPrice: 205, qty: 0.5 })
      expect(queue.send).toHaveBeenCalledWith({ tradeId: trade.id, kind: 'buy' })
    })

    it('cancels trades whose order died', async () => {
      stubFetch([orderRoute('o1', 'expired')])
      const trade = await insertTrade({ status: 'pending', orderId: 'o1' })
      await reconcileTrade(deps, trade, new Set(), new Date())
      const row = await reload(trade)
      expect(row).toMatchObject({
        status: 'cancelled',
        exitReason: 'order expired',
        exitPrice: null,
      })
      expect(row?.closedAt).toMatch(/Z$/)
      expect(queue.send).not.toHaveBeenCalled()
    })

    it('leaves cancelled trades alone', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { calls } = stubFetch([])
      const trade = await insertTrade({ status: 'cancelled', orderId: 'o1' })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect((await reload(trade))?.status).toBe('cancelled')
      expect(calls).toHaveLength(0)
      expect(error).not.toHaveBeenCalled()
    })

    it('re-places a limit order the broker expired while it is still alive', async () => {
      const { calls } = stubFetch([
        orderRoute('o1', 'expired'),
        {
          url: `${ALPACA}/v2/orders`,
          method: 'POST',
          body: orderJson({ id: 'o2', status: 'new' }),
        },
      ])
      const trade = await insertTrade({
        status: 'pending',
        orderId: 'o1',
        qty: 2,
        limitPrice: 190,
        expiresAt: '2999-01-01T00:00:00.000Z',
      })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect(await reload(trade)).toMatchObject({ status: 'pending', orderId: 'o2' })
      expect(jsonBody(calls[1])).toMatchObject({
        symbol: 'AAPL',
        qty: '2',
        limit_price: '190.00',
        extended_hours: true,
      })
    })

    it('cancels a working order once its alive window has ended', async () => {
      const { calls } = stubFetch([
        orderRoute('o1', 'new'),
        { url: `${ALPACA}/v2/orders/o1`, method: 'DELETE', status: 204, body: '' },
      ])
      const trade = await insertTrade({
        status: 'pending',
        orderId: 'o1',
        limitPrice: 190,
        expiresAt: '2000-01-01T00:00:00.000Z',
      })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect(await reload(trade)).toMatchObject({
        status: 'cancelled',
        exitReason: 'alive window ended',
      })
      expect(calls.map((c) => c.method)).toEqual(['GET', 'DELETE'])
    })

    it('lets an expired broker order of a dead window go without re-placing it', async () => {
      const { calls } = stubFetch([orderRoute('o1', 'expired')])
      const trade = await insertTrade({
        status: 'pending',
        orderId: 'o1',
        limitPrice: 190,
        expiresAt: '2000-01-01T00:00:00.000Z',
      })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect(await reload(trade)).toMatchObject({
        status: 'cancelled',
        exitReason: 'alive window ended',
      })
      expect(calls).toHaveLength(1)
    })

    it('waits while the order is still working', async () => {
      stubFetch([orderRoute('o1', 'new')])
      const trade = await insertTrade({ status: 'pending', orderId: 'o1' })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect((await reload(trade))?.status).toBe('pending')
    })
  })

  describe('closing', () => {
    it('reopens trades without a close order', async () => {
      const trade = await insertTrade({ status: 'closing', exitReason: 'stop' })
      await reconcileTrade(deps, trade, new Set(['AAPL']), new Date())
      expect(await reload(trade)).toMatchObject({ status: 'open', exitReason: null })
    })

    it('finalizes filled close orders', async () => {
      stubFetch([orderRoute('c1', 'filled', '222')])
      const trade = await insertTrade({
        status: 'closing',
        exitReason: 'target',
        closeOrderId: 'c1',
      })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect(await reload(trade)).toMatchObject({ status: 'closed', exitPrice: 222 })
      expect(queue.send).toHaveBeenCalledWith({ tradeId: trade.id, kind: 'sell' })
    })

    it('uses the entry price when the fill has no average', async () => {
      stubFetch([orderRoute('c1', 'filled', null)])
      const trade = await insertTrade({
        status: 'closing',
        exitReason: 'target',
        closeOrderId: 'c1',
      })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect((await reload(trade))?.exitPrice).toBe(200)
    })

    it('reopens trades whose close order died', async () => {
      stubFetch([orderRoute('c1', 'canceled')])
      const trade = await insertTrade({ status: 'closing', exitReason: 'stop', closeOrderId: 'c1' })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect(await reload(trade)).toMatchObject({
        status: 'open',
        exitReason: null,
        closeOrderId: null,
      })
    })

    it('waits while the close order is working', async () => {
      stubFetch([orderRoute('c1', 'partially_filled')])
      const trade = await insertTrade({ status: 'closing', exitReason: 'stop', closeOrderId: 'c1' })
      await reconcileTrade(deps, trade, new Set(), new Date())
      expect((await reload(trade))?.status).toBe('closing')
    })
  })

  describe('open', () => {
    it('closes settled trades the broker no longer holds', async () => {
      const trade = await insertTrade({ openedAt: '2026-09-01T12:00:00.000Z' })
      await reconcileTrade(deps, trade, new Set(['MSFT']), new Date('2026-09-01T12:10:00.001Z'))
      expect(await reload(trade)).toMatchObject({
        status: 'closed',
        exitReason: 'position missing at broker',
        exitPrice: 200,
      })
      expect(MISSING_AT_BROKER).toBe('position missing at broker')
    })

    it('keeps held trades and trades inside the ten minute grace period', async () => {
      const openedAt = '2026-09-01T12:00:00.000Z'
      const held = await insertTrade({ openedAt })
      const fresh = await insertTrade({ symbol: 'BTC/USD', openedAt })
      await reconcileTrade(deps, held, new Set(['AAPL']), new Date('2026-09-01T12:30:00.000Z'))
      await reconcileTrade(deps, fresh, new Set(), new Date('2026-09-01T12:10:00.000Z'))
      expect((await reload(held))?.status).toBe('open')
      expect((await reload(fresh))?.status).toBe('open')
    })
  })

  it('ignores closed trades', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { calls } = stubFetch([])
    const trade = await insertTrade({ status: 'closed', closedAt: minutesAgo(1) })
    await reconcileTrade(deps, trade, new Set(), new Date())
    expect(calls).toHaveLength(0)
    expect(error).not.toHaveBeenCalled()
    expect((await reload(trade))?.status).toBe('closed')
  })

  it('logs broker failures without throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubFetch([{ url: `${ALPACA}/v2/orders/o1`, status: 500, body: 'down' }])
    const trade = await insertTrade({ status: 'pending', orderId: 'o1' })
    await reconcileTrade(deps, trade, new Set(), new Date())
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"message":"reconcile failed"'))
    expect(error).toHaveBeenCalledWith(expect.stringContaining('alpaca 500'))
    expect((await reload(trade))?.status).toBe('pending')
  })
})

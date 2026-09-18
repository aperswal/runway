import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  INTERNAL_TOKEN,
  db,
  fakeQueue,
  insertTrade,
  orderJson,
  resetDb,
  seedFund,
  stubFetch,
  testEnv,
} from '../test/helpers'
import { app } from './app'
import { buildDeps } from './deps'
import { trades } from './db/schema'
import { liquidateAll, liquidating, liquidationNotice } from './liquidation'

describe('liquidation', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
    vi.unstubAllGlobals()
  })

  it('flags open lots, cancels queued orders, and reports the counts', async () => {
    await insertTrade({ symbol: 'AAPL' })
    await insertTrade({
      symbol: 'MSFT',
      status: 'pending',
      orderId: 'o-1',
      qty: 2,
      limitPrice: 100,
    })
    stubFetch([
      { url: `${ALPACA}/v2/orders/o-1`, body: orderJson({ id: 'o-1', status: 'new' }) },
      { url: `${ALPACA}/v2/orders/o-1`, method: 'DELETE', status: 204, body: '' },
    ])
    const deps = { ...buildDeps(testEnv()), postQueue: fakeQueue().queue }
    expect(await liquidateAll(deps)).toEqual({ flagged: 1, cancelled: 1 })
    const rows = await db.select().from(trades)
    expect(rows.map((t) => [t.symbol, t.status, t.liquidate])).toEqual([
      ['AAPL', 'open', true],
      ['MSFT', 'cancelled', false],
    ])
    expect(await liquidationNotice(db)).toBe(true)
    expect(await liquidateAll(deps)).toEqual({ flagged: 0, cancelled: 0 })
  })

  it('knows whether any open lot is being liquidated', () => {
    expect(liquidating([{ liquidate: true, status: 'closed' }])).toBe(false)
    expect(liquidating([{ liquidate: true, status: 'open' }])).toBe(true)
    expect(liquidating([])).toBe(false)
  })

  it('is exposed as an internal route', async () => {
    await insertTrade({ symbol: 'AAPL' })
    const res = await app.fetch(
      new Request('http://site.test/internal/liquidate', {
        method: 'POST',
        headers: { authorization: `Bearer ${INTERNAL_TOKEN}` },
      }),
      testEnv(),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ flagged: 1, cancelled: 0 })
    expect(await liquidationNotice(db)).toBe(true)
  })
})

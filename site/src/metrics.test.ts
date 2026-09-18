import { describe, expect, it } from 'vitest'
import type { Trade } from './db/schema'
import { tradeMetrics, tradePl, tradeReturnPct } from './metrics'

const base: Trade = {
  id: 1,
  fund: 'social',
  symbol: 'AAPL',
  assetClass: 'us_equity',
  notional: 100,
  qty: 2,
  entryPrice: 100,
  stop: 90,
  target: 120,
  trailPct: null,
  entryStop: null,
  liquidate: false,
  horizon: '1 week',
  reason: 'r',
  status: 'closed',
  orderId: null,
  limitPrice: null,
  expiresAt: null,
  closeOrderId: null,
  exitPrice: 110,
  exitReason: 'target',
  openedAt: '2026-09-01T12:00:00.000Z',
  closedAt: '2026-09-02T00:00:00.000Z',
}

describe('trade math', () => {
  it('computes return and pl from exit price', () => {
    expect(tradeReturnPct(base)).toBe(10)
    expect(tradePl(base)).toBe(20)
  })

  it('treats a missing exit price as flat', () => {
    const flat = { ...base, exitPrice: null }
    expect(tradeReturnPct(flat)).toBe(0)
    expect(tradePl(flat)).toBe(0)
  })
})

describe('tradeMetrics', () => {
  it('is empty without settled trades', () => {
    expect(tradeMetrics([{ ...base, qty: 0 }])).toEqual({
      closed: 0,
      winRate: null,
      avgReturnPct: null,
      avgHoldHours: null,
      profitFactor: null,
      realizedPl: 0,
    })
  })

  it('aggregates wins and losses', () => {
    const loser = { ...base, id: 2, exitPrice: 95, closedAt: null }
    const m = tradeMetrics([base, loser])
    expect(m.closed).toBe(2)
    expect(m.winRate).toBe(50)
    expect(m.avgReturnPct).toBeCloseTo(2.5)
    expect(m.avgHoldHours).toBe(6)
    expect(m.profitFactor).toBe(2)
    expect(m.realizedPl).toBe(10)
  })

  it('counts only strictly profitable trades as wins', () => {
    const loser = { ...base, id: 2, exitPrice: 95 }
    const flat = { ...base, id: 3, exitPrice: null }
    const m = tradeMetrics([base, loser, flat])
    expect(m.winRate).toBeCloseTo(100 / 3)
    expect(m.profitFactor).toBe(2)
    expect(m.realizedPl).toBe(10)
  })

  it('has no profit factor without losses', () => {
    expect(tradeMetrics([base]).profitFactor).toBeNull()
  })
})

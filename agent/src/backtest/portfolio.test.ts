import { describe, expect, it } from 'vitest'
import { pairs, xsMomentum } from './portfolio.ts'
import { DEFAULT_PARAMS, type Bar } from './strategies.ts'

const bar = (t: string, c: number): Bar => ({ t, o: c, h: c, l: c, c, v: 0 })
const series = (closes: number[]): Bar[] => closes.map((c, i) => bar(`d${i}`, c))
const withGap = (bars: Bar[], gap: number): Bar[] => {
  const out: Bar[] = []
  bars.forEach((b, i) => {
    if (i !== gap) {
      out[i] = b
    }
  })
  return out
}
const empty = {
  trades: [],
  returnPct: 0,
  buyAndHoldPct: 0,
  maxDrawdownPct: 0,
  winRate: null,
  avgTradePct: null,
}

describe('pairs', () => {
  const params = { ...DEFAULT_PARAMS, lookback: 2, entry: 1, exit: 0 }
  it('reports zeros and nulls for no bars', () =>
    expect(pairs({ symbol: 'A', bars: [] }, { symbol: 'B', bars: [] }, params)).toEqual({
      symbol: 'A/B',
      bars: 0,
      ...empty,
    }))
  it('goes long a falling spread, short a rising one, and exits when it reverts', () => {
    const a = { symbol: 'A', bars: series([24, 16, 12, 12, 24, 12, 12]) }
    const b = { symbol: 'B', bars: series([2, 2, 2, 2, 2, 2, 2]) }
    expect(pairs(a, b, params)).toEqual({
      symbol: 'A/B',
      bars: 7,
      trades: [
        { entryAt: 'd1', exitAt: 'd3', entry: 8, exit: 6, reason: 'signal' },
        { entryAt: 'd4', exitAt: 'd6', entry: 12, exit: 24, reason: 'signal' },
      ],
      returnPct: 50,
      buyAndHoldPct: -25,
      maxDrawdownPct: 25,
      winRate: 50,
      avgTradePct: 37.5,
    })
  })
  it('holds through a spread that widens past the entry without re-entering', () => {
    const a = { symbol: 'A', bars: series([8, 16, 32, 64]) }
    const b = { symbol: 'B', bars: series([1, 1, 1, 1]) }
    expect(pairs(a, b, params)).toEqual({
      symbol: 'A/B',
      bars: 4,
      trades: [],
      returnPct: -75,
      buyAndHoldPct: 350,
      maxDrawdownPct: 75,
      winRate: null,
      avgTradePct: null,
    })
  })
  it('stays flat while the spread is inside the entry band', () => {
    const a = { symbol: 'A', bars: series([8, 16, 32]) }
    const b = { symbol: 'B', bars: series([1, 1, 1]) }
    expect(pairs(a, b, { ...params, entry: 2 })).toMatchObject({
      bars: 3,
      trades: [],
      returnPct: 0,
      maxDrawdownPct: 0,
    })
  })
  it('only pairs bars whose dates both legs share', () => {
    const a = { symbol: 'A', bars: [bar('d0', 1), bar('d1', 10), bar('d2', 20)] }
    const b = { symbol: 'B', bars: [bar('d1', 5), bar('d2', 5), bar('d3', 100)] }
    expect(pairs(a, b, params)).toEqual({
      symbol: 'A/B',
      bars: 2,
      trades: [],
      returnPct: 0,
      buyAndHoldPct: 50,
      maxDrawdownPct: 0,
      winRate: null,
      avgTradePct: null,
    })
  })
  it('reports a single shared bar without a trade or a hold', () => {
    const a = { symbol: 'A', bars: [bar('d0', 1), bar('d1', 10)] }
    const b = { symbol: 'B', bars: [bar('d1', 5), bar('d2', 100)] }
    expect(pairs(a, b, params)).toEqual({ symbol: 'A/B', bars: 1, ...empty })
  })
  it('trades the price ratio, not the product', () => {
    const a = { symbol: 'A', bars: series([8, 4, 8]) }
    const b = { symbol: 'B', bars: series([1, 2, 1]) }
    expect(pairs(a, b, params)).toMatchObject({ trades: [], returnPct: 300, maxDrawdownPct: 0 })
  })
  it('measures drawdown from the running peak', () => {
    const a = { symbol: 'A', bars: series([16, 8, 16, 12, 12]) }
    const b = { symbol: 'B', bars: series([1, 1, 1, 1, 1]) }
    expect(pairs(a, b, params)).toEqual({
      symbol: 'A/B',
      bars: 5,
      trades: [{ entryAt: 'd1', exitAt: 'd4', entry: 8, exit: 12, reason: 'signal' }],
      returnPct: 50,
      buyAndHoldPct: -12.5,
      maxDrawdownPct: 25,
      winRate: 100,
      avgTradePct: 50,
    })
  })
  it('waits for the window even when entry is zero, then shorts a flat spread', () => {
    const a = { symbol: 'A', bars: series([8, 8, 16]) }
    const b = { symbol: 'B', bars: series([1, 1, 1]) }
    expect(pairs(a, b, { ...params, entry: 0 })).toMatchObject({ trades: [], returnPct: -50 })
  })
})

describe('xsMomentum', () => {
  const params = { ...DEFAULT_PARAMS, lookback: 1, rebalance: 3, top: 1 }
  it('reports zeros and nulls for an empty universe', () =>
    expect(xsMomentum({}, params)).toEqual({ symbol: 'universe', bars: 0, ...empty }))
  it('ranks by lookback return, holds the top, and rebalances on schedule', () =>
    expect(
      xsMomentum(
        { A: series([1, 2, 1.5, 1.5, 1.75, 1.75]), B: series([8, 12, 12, 15, 18, 27]) },
        params,
      ),
    ).toEqual({
      symbol: 'universe',
      bars: 6,
      trades: [{ entryAt: 'd1', exitAt: 'd4', entry: 2, exit: 1.75, reason: 'rebalance' }],
      returnPct: 31.25,
      buyAndHoldPct: 56.25,
      maxDrawdownPct: 25,
      winRate: 0,
      avgTradePct: -12.5,
    }))
  it('rebalances a single-symbol universe every bar', () =>
    expect(xsMomentum({ A: series([10, 20, 15]) }, { ...params, rebalance: 1 })).toEqual({
      symbol: 'universe',
      bars: 3,
      trades: [{ entryAt: 'd1', exitAt: 'd2', entry: 20, exit: 15, reason: 'rebalance' }],
      returnPct: -25,
      buyAndHoldPct: -25,
      maxDrawdownPct: 25,
      winRate: 0,
      avgTradePct: -25,
    }))
  it('holds the whole universe equally when top exceeds it', () =>
    expect(
      xsMomentum({ A: series([10, 20, 10]), B: series([10, 10, 20]) }, { ...params, top: 5 }),
    ).toEqual({
      symbol: 'universe',
      bars: 3,
      trades: [],
      returnPct: 25,
      buyAndHoldPct: 25,
      maxDrawdownPct: 0,
      winRate: null,
      avgTradePct: null,
    }))
  it('splits the rebalance factor across every holding', () =>
    expect(
      xsMomentum(
        { A: series([10, 20, 40]), B: series([8, 8, 4]) },
        { ...params, rebalance: 1, top: 2 },
      ),
    ).toEqual({
      symbol: 'universe',
      bars: 3,
      trades: [
        { entryAt: 'd1', exitAt: 'd2', entry: 20, exit: 40, reason: 'rebalance' },
        { entryAt: 'd1', exitAt: 'd2', entry: 8, exit: 4, reason: 'rebalance' },
      ],
      returnPct: 25,
      buyAndHoldPct: 25,
      maxDrawdownPct: 0,
      winRate: 50,
      avgTradePct: 25,
    }))
  it('holds nothing when top is zero', () =>
    expect(xsMomentum({ A: series([10, 20, 30]) }, { ...params, top: 0 })).toEqual({
      symbol: 'universe',
      bars: 3,
      ...empty,
      buyAndHoldPct: 50,
    }))
  it('truncates to the shortest symbol and skips symbols without a lookback bar', () =>
    expect(xsMomentum({ A: series([10, 20, 30]), B: series([5]) }, params)).toEqual({
      symbol: 'universe',
      bars: 1,
      ...empty,
      buyAndHoldPct: -25,
    }))
  it('has no buy-and-hold when a symbol has no bars', () =>
    expect(xsMomentum({ A: series([10, 20]), B: [] }, params)).toEqual({
      symbol: 'universe',
      bars: 0,
      ...empty,
    }))
  it('carries a holding at its entry price through a missing bar', () =>
    expect(
      xsMomentum(
        { A: withGap(series([10, 20, 30, 40]), 2), B: series([10, 10, 5, 5]) },
        { ...params, rebalance: 2, top: 2 },
      ),
    ).toEqual({
      symbol: 'universe',
      bars: 4,
      trades: [
        { entryAt: 'd1', exitAt: 'd3', entry: 20, exit: 40, reason: 'rebalance' },
        { entryAt: 'd1', exitAt: 'd3', entry: 10, exit: 5, reason: 'rebalance' },
      ],
      returnPct: 25,
      buyAndHoldPct: 25,
      maxDrawdownPct: 25,
      winRate: 50,
      avgTradePct: 25,
    }))
  it('closes a holding at its entry when the rebalance bar is missing', () =>
    expect(
      xsMomentum(
        { A: withGap(series([10, 20, 30, 40]), 2), B: series([10, 10, 10, 10]) },
        { ...params, rebalance: 1 },
      ),
    ).toEqual({
      symbol: 'universe',
      bars: 4,
      trades: [
        { entryAt: 'd1', exitAt: 'd1', entry: 20, exit: 20, reason: 'rebalance' },
        { entryAt: 'd2', exitAt: 'd3', entry: 10, exit: 10, reason: 'rebalance' },
      ],
      returnPct: 0,
      buyAndHoldPct: 50,
      maxDrawdownPct: 0,
      winRate: 0,
      avgTradePct: 0,
    }))
})

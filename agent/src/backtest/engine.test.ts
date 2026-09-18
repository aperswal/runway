import { describe, expect, it } from 'vitest'
import { simulate } from './engine.ts'
import type { Bar, Signal, Strategy } from './strategies.ts'

const bar = (t: string, c: number, h = c, l = c): Bar => ({ t, o: c, h, l, c, v: 0 })
const signals =
  (list: Signal[]): Strategy =>
  (_closes, i) =>
    list[i] ?? 'flat'
const none = { stopPct: Infinity, targetPct: Infinity }

describe('simulate', () => {
  it('reports zeros and nulls for no bars', () =>
    expect(simulate('AAPL', [], signals([]), none)).toEqual({
      symbol: 'AAPL',
      bars: 0,
      trades: [],
      returnPct: 0,
      buyAndHoldPct: 0,
      maxDrawdownPct: 0,
      winRate: null,
      avgTradePct: null,
    }))
  it('enters on long, exits on flat and tracks drawdown from the peak', () => {
    const bars = [bar('d0', 10), bar('d1', 12), bar('d2', 11)]
    const report = simulate('AAPL', bars, signals(['long', 'long', 'flat']), none)
    expect(report.trades).toEqual([
      { entryAt: 'd0', exitAt: 'd2', entry: 10, exit: 11, reason: 'signal' },
    ])
    expect(report).toMatchObject({ bars: 3, winRate: 100 })
    expect(report.avgTradePct).toBeCloseTo(10)
    expect(report.returnPct).toBeCloseTo(10)
    expect(report.buyAndHoldPct).toBeCloseTo(10)
    expect(report.maxDrawdownPct).toBeCloseTo((0.1 / 1.2) * 100)
  })
  it('counts a flat trade as a loss and averages over every trade', () => {
    const bars = [bar('d0', 10), bar('d1', 10), bar('d2', 10), bar('d3', 12)]
    const report = simulate('AAPL', bars, signals(['long', 'flat', 'long', 'flat']), none)
    expect(report.trades).toEqual([
      { entryAt: 'd0', exitAt: 'd1', entry: 10, exit: 10, reason: 'signal' },
      { entryAt: 'd2', exitAt: 'd3', entry: 10, exit: 12, reason: 'signal' },
    ])
    expect(report.winRate).toBe(50)
    expect(report.avgTradePct).toBeCloseTo(10)
    expect(report.returnPct).toBeCloseTo(20)
  })
  it('holds an open position without exits and marks it to market', () => {
    const bars = [bar('d0', 10), bar('d1', 8), bar('d2', 9)]
    const report = simulate('AAPL', bars, signals(['long', 'long', 'long']), none)
    expect(report.trades).toEqual([])
    expect(report.returnPct).toBeCloseTo(-10)
    expect(report.maxDrawdownPct).toBeCloseTo(20)
  })
  it('forces a stop exit, re-enters and marks the open position at the end', () => {
    const bars = [bar('d0', 100), bar('d1', 96, 100, 94), bar('d2', 98), bar('d3', 99)]
    const report = simulate('AAPL', bars, signals(['long', 'long', 'long', 'long']), {
      stopPct: 5,
      targetPct: Infinity,
    })
    expect(report.trades).toMatchObject([
      { entryAt: 'd0', exitAt: 'd1', entry: 100, reason: 'stop' },
    ])
    expect(report.trades[0]?.exit).toBeCloseTo(95)
    expect(report.returnPct).toBeCloseTo((0.95 * (99 / 98) - 1) * 100)
    expect(report.maxDrawdownPct).toBeCloseTo(5)
    expect(report.winRate).toBe(0)
    expect(report.avgTradePct).toBeCloseTo(-5)
  })
  it('stops when the low touches the stop price exactly', () => {
    const bars = [bar('d0', 200), bar('d1', 150, 150, 100)]
    const report = simulate('AAPL', bars, signals(['long', 'long']), { ...none, stopPct: 50 })
    expect(report.trades).toEqual([
      { entryAt: 'd0', exitAt: 'd1', entry: 200, exit: 100, reason: 'stop' },
    ])
  })
  it('takes profit when the high touches the target price exactly', () => {
    const bars = [bar('d0', 100), bar('d1', 120, 150, 110)]
    const report = simulate('AAPL', bars, signals(['long', 'long']), { ...none, targetPct: 50 })
    expect(report.trades).toEqual([
      { entryAt: 'd0', exitAt: 'd1', entry: 100, exit: 150, reason: 'target' },
    ])
  })
  it('holds through a bar that hits neither exit and forces a target exit', () => {
    const bars = [bar('d0', 100), bar('d1', 101, 105, 97), bar('d2', 108, 111, 100)]
    const report = simulate('AAPL', bars, signals(['long', 'long', 'long']), {
      stopPct: 5,
      targetPct: 10,
    })
    expect(report.trades).toMatchObject([
      { entryAt: 'd0', exitAt: 'd2', entry: 100, reason: 'target' },
    ])
    expect(report.trades[0]?.exit).toBeCloseTo(110)
    expect(report.returnPct).toBeCloseTo(10)
  })
  it('stays flat without a long signal', () => {
    const report = simulate('AAPL', [bar('d0', 1), bar('d1', 2)], signals(['flat']), none)
    expect(report).toMatchObject({ trades: [], returnPct: 0, buyAndHoldPct: 100 })
  })
})

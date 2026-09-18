import type { Bar, Signal, Strategy } from './strategies.ts'

export type Exits = { stopPct: number; targetPct: number }
export type SimTrade = {
  entryAt: string
  exitAt: string
  entry: number
  exit: number
  reason: string
}
export type Report = {
  symbol: string
  bars: number
  trades: SimTrade[]
  returnPct: number
  buyAndHoldPct: number
  maxDrawdownPct: number
  winRate: number | null
  avgTradePct: number | null
}

const PERCENT = 100

type Open = { entryAt: string; entry: number }

function exitReason(bar: Bar, open: Open, exits: Exits): { price: number; reason: string } | null {
  const stop = open.entry * (1 - exits.stopPct / PERCENT)
  if (bar.l <= stop) {
    return { price: stop, reason: 'stop' }
  }
  const target = open.entry * (1 + exits.targetPct / PERCENT)
  if (bar.h >= target) {
    return { price: target, reason: 'target' }
  }
  return null
}

export function simulate(symbol: string, bars: Bar[], strategy: Strategy, exits: Exits): Report {
  const closes = bars.map((b) => b.c)
  const trades: SimTrade[] = []
  let open: Open | null = null
  let equity = 1
  let marked = 1
  let peak = 1
  let maxDrawdown = 0
  bars.forEach((bar, i) => {
    const signal = strategy(closes, i)
    if (open === null) {
      open = signal === 'long' ? { entryAt: bar.t, entry: bar.c } : null
    } else {
      const closed = closeIfDue(bar, open, exits, signal)
      if (closed !== null) {
        trades.push(closed)
        equity *= closed.exit / closed.entry
        open = null
      }
    }
    marked = open === null ? equity : equity * (bar.c / open.entry)
    peak = Math.max(peak, marked)
    maxDrawdown = Math.max(maxDrawdown, (peak - marked) / peak)
  })
  return summarize(symbol, bars, trades, { finalEquity: marked, maxDrawdown })
}

function closeIfDue(bar: Bar, open: Open, exits: Exits, signal: Signal): SimTrade | null {
  const forced = exitReason(bar, open, exits)
  if (forced === null && signal === 'long') {
    return null
  }
  return {
    entryAt: open.entryAt,
    exitAt: bar.t,
    entry: open.entry,
    exit: forced?.price ?? bar.c,
    reason: forced?.reason ?? 'signal',
  }
}

type Tail = { finalEquity: number; maxDrawdown: number }

function summarize(symbol: string, bars: Bar[], trades: SimTrade[], tail: Tail): Report {
  const firstClose = bars[0]?.c ?? 1
  const lastClose = bars.at(-1)?.c ?? firstClose
  const returns = trades.map((t) => (t.exit / t.entry - 1) * PERCENT)
  return {
    symbol,
    bars: bars.length,
    trades,
    returnPct: (tail.finalEquity - 1) * PERCENT,
    buyAndHoldPct: (lastClose / firstClose - 1) * PERCENT,
    maxDrawdownPct: tail.maxDrawdown * PERCENT,
    winRate:
      returns.length === 0
        ? null
        : (returns.filter((r) => r > 0).length / returns.length) * PERCENT,
    avgTradePct:
      returns.length === 0 ? null : returns.reduce((sum, r) => sum + r, 0) / returns.length,
  }
}

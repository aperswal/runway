import type { Report, SimTrade } from './engine.ts'
import { zScore, type Bar, type StrategyParams } from './strategies.ts'

const PERCENT = 100
const HALF = 2

export type Leg = { symbol: string; bars: Bar[] }
type Curve = {
  symbol: string
  bars: number
  curve: number[]
  trades: SimTrade[]
  buyAndHoldPct: number
}

function toReport(c: Curve): Report {
  let peak = 1
  let maxDrawdown = 0
  c.curve.forEach((e) => {
    peak = Math.max(peak, e)
    maxDrawdown = Math.max(maxDrawdown, (peak - e) / peak)
  })
  const returns = c.trades.map((t) => (t.exit / t.entry - 1) * PERCENT)
  return {
    symbol: c.symbol,
    bars: c.bars,
    trades: c.trades,
    returnPct: ((c.curve.at(-1) ?? 1) - 1) * PERCENT,
    buyAndHoldPct: c.buyAndHoldPct,
    maxDrawdownPct: maxDrawdown * PERCENT,
    winRate:
      returns.length === 0
        ? null
        : (returns.filter((r) => r > 0).length / returns.length) * PERCENT,
    avgTradePct:
      returns.length === 0 ? null : returns.reduce((sum, r) => sum + r, 0) / returns.length,
  }
}

type Row = { t: string; a: number; b: number }

const alignedCloses = (a: Bar[], b: Bar[]): Row[] => {
  const byDay = new Map(b.map((bar) => [bar.t, bar.c]))
  return a.flatMap((bar) => {
    const other = byDay.get(bar.t)
    return other === undefined ? [] : [{ t: bar.t, a: bar.c, b: other }]
  })
}

const holdPct = (first: Row, last: Row): number =>
  ((last.a / first.a + last.b / first.b) / HALF - 1) * PERCENT

type PairPosition = { entryAt: string; entry: number; side: 1 | -1 }

const markPair = (open: PairPosition, ratio: number): number =>
  open.side === 1 ? ratio / open.entry : open.entry / ratio

function stepPair(
  open: PairPosition | null,
  z: number | null,
  row: Row,
  p: StrategyParams,
): { open: PairPosition | null; closed: SimTrade | null } {
  const ratio = row.a / row.b
  if (z === null) {
    return { open, closed: null }
  }
  if (open !== null && Math.abs(z) <= p.exit) {
    const exit = open.entry * markPair(open, ratio)
    return {
      open: null,
      closed: { entryAt: open.entryAt, exitAt: row.t, entry: open.entry, exit, reason: 'signal' },
    }
  }
  if (open === null && Math.abs(z) >= p.entry) {
    return { open: { entryAt: row.t, entry: ratio, side: z < 0 ? 1 : -1 }, closed: null }
  }
  return { open, closed: null }
}

export function pairs(legA: Leg, legB: Leg, p: StrategyParams): Report {
  const rows = alignedCloses(legA.bars, legB.bars)
  const spread = rows.map((r) => Math.log(r.a) - Math.log(r.b))
  const trades: SimTrade[] = []
  const curve: number[] = []
  let equity = 1
  let open: PairPosition | null = null
  rows.forEach((row, i) => {
    const step = stepPair(open, zScore(spread, i, p.lookback), row, p)
    if (step.closed !== null) {
      trades.push(step.closed)
      equity *= step.closed.exit / step.closed.entry
    }
    open = step.open
    curve.push(open === null ? equity : equity * markPair(open, row.a / row.b))
  })
  const [first, ...rest] = rows
  const hold = first === undefined ? 0 : holdPct(first, rest.at(-1) ?? first)
  return toReport({
    symbol: `${legA.symbol}/${legB.symbol}`,
    bars: rows.length,
    curve,
    trades,
    buyAndHoldPct: hold,
  })
}

type Holding = { symbol: string; bars: Bar[]; entry: number; entryAt: string }
type Ranked = { symbol: string; bars: Bar[]; bar: Bar; then: Bar }
type Universe = Record<string, Bar[]>

function rank(universe: Universe, i: number, p: StrategyParams): Holding[] {
  return Object.entries(universe)
    .map(([symbol, bars]) => ({ symbol, bars, bar: bars[i], then: bars[i - p.lookback] }))
    .filter((x): x is Ranked => x.bar !== undefined && x.then !== undefined)
    .sort((x, y) => y.bar.c / y.then.c - x.bar.c / x.then.c)
    .slice(0, p.top)
    .map((x) => ({ symbol: x.symbol, bars: x.bars, entry: x.bar.c, entryAt: x.bar.t }))
}

function liquidate(held: Holding[], i: number, trades: SimTrade[]): number {
  return held.reduce((factor, h) => {
    const bar = h.bars[i]
    const exit = bar?.c ?? h.entry
    trades.push({
      entryAt: h.entryAt,
      exitAt: bar?.t ?? h.entryAt,
      entry: h.entry,
      exit,
      reason: 'rebalance',
    })
    return factor + exit / h.entry / held.length
  }, 0)
}

export function xsMomentum(universe: Universe, p: StrategyParams): Report {
  const series = Object.values(universe)
  const length = series.length === 0 ? 0 : Math.min(...series.map((bars) => bars.length))
  const curve: number[] = []
  const trades: SimTrade[] = []
  let equity = 1
  let held: Holding[] = []
  for (let i = p.lookback; i < length; i += 1) {
    if ((i - p.lookback) % p.rebalance === 0) {
      equity *= held.length === 0 ? 1 : liquidate(held, i, trades)
      held = rank(universe, i, p)
    }
    const marked = held.reduce((sum, h) => sum + (h.bars[i]?.c ?? h.entry) / h.entry, 0)
    curve.push(held.length === 0 ? equity : equity * (marked / held.length))
  }
  const hold = series.reduce((sum, bars) => {
    const first = bars[p.lookback]?.c
    const last = bars[length - 1]?.c
    return first === undefined || last === undefined
      ? sum
      : sum + (last / first - 1) / series.length
  }, 0)
  return toReport({
    symbol: 'universe',
    bars: length,
    curve,
    trades,
    buyAndHoldPct: hold * PERCENT,
  })
}

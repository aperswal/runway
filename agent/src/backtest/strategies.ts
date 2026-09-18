export type Bar = { t: string; o: number; h: number; l: number; c: number; v: number }
export type Signal = 'long' | 'flat'
export type Strategy = (closes: number[], index: number) => Signal

export type StrategyParams = {
  fast: number
  slow: number
  lookback: number
  period: number
  low: number
  high: number
  entry: number
  exit: number
  top: number
  rebalance: number
}

export const DEFAULT_PARAMS: StrategyParams = {
  fast: 10,
  slow: 50,
  lookback: 20,
  period: 14,
  low: 30,
  high: 70,
  entry: 2,
  exit: 0.5,
  top: 3,
  rebalance: 20,
}

export const STRATEGY_NAMES = [
  'sma-cross',
  'breakout',
  'rsi',
  'momentum',
  'mean-reversion',
] as const
export const PORTFOLIO_STRATEGY_NAMES = ['pairs', 'xs-momentum'] as const
export type PortfolioStrategyName = (typeof PORTFOLIO_STRATEGY_NAMES)[number]
export type StrategyName = (typeof STRATEGY_NAMES)[number]

export function sma(values: number[], end: number, length: number): number {
  let sum = 0
  for (let i = end + 1 - length; i <= end; i += 1) {
    sum += values[i] ?? 0
  }
  return sum / length
}

export function rsi(values: number[], end: number, period: number): number | null {
  if (end < period) {
    return null
  }
  let gains = 0
  let losses = 0
  for (let i = end - period + 1; i <= end; i += 1) {
    const change = (values[i] ?? 0) - (values[i - 1] ?? 0)
    gains += Math.max(change, 0)
    losses += Math.max(-change, 0)
  }
  if (losses === 0) {
    return RSI_MAX
  }
  return RSI_MAX - RSI_MAX / (1 + gains / losses)
}

const RSI_MAX = 100

const smaCross =
  (p: StrategyParams): Strategy =>
  (closes, i) => {
    if (i + 1 < Math.max(p.fast, p.slow)) {
      return 'flat'
    }
    return sma(closes, i, p.fast) > sma(closes, i, p.slow) ? 'long' : 'flat'
  }

function windowMax(values: number[], start: number, end: number): number {
  let max = Number.NEGATIVE_INFINITY
  for (let i = start; i < end; i += 1) {
    max = Math.max(max, values[i] ?? Number.NEGATIVE_INFINITY)
  }
  return max
}

const breakout =
  (p: StrategyParams): Strategy =>
  (closes, i) => {
    if (i < p.lookback) {
      return 'flat'
    }
    const prior = windowMax(closes, i - p.lookback, i)
    return (closes[i] ?? 0) > prior ? 'long' : 'flat'
  }

const rsiStrategy =
  (p: StrategyParams): Strategy =>
  (closes, i) => {
    const value = rsi(closes, i, p.period)
    if (value === null) {
      return 'flat'
    }
    return value < p.low ? 'long' : 'flat'
  }

const momentum =
  (p: StrategyParams): Strategy =>
  (closes, i) =>
    i >= p.lookback && (closes[i] ?? 0) > (closes[i - p.lookback] ?? 0) ? 'long' : 'flat'

function windowVariance(values: number[], start: number, end: number, mean: number): number {
  let variance = 0
  for (let i = start; i <= end; i += 1) {
    const gap = (values[i] ?? 0) - mean
    variance += gap * gap
  }
  return variance / (end - start + 1)
}

export function zScore(values: number[], end: number, length: number): number | null {
  if (end + 1 < length) {
    return null
  }
  const start = end + 1 - length
  const mean = sma(values, end, length)
  const deviation = Math.sqrt(windowVariance(values, start, end, mean))
  return deviation === 0 ? 0 : ((values[end] ?? mean) - mean) / deviation
}

const meanReversion =
  (p: StrategyParams): Strategy =>
  (closes, i) => {
    const z = zScore(closes, i, p.lookback)
    if (z === null) {
      return 'flat'
    }
    return z <= -p.entry ? 'long' : 'flat'
  }

export const isPortfolioStrategyName = (
  value: string | undefined,
): value is PortfolioStrategyName =>
  (PORTFOLIO_STRATEGY_NAMES as readonly (string | undefined)[]).includes(value)

export const STRATEGIES: Record<StrategyName, (p: StrategyParams) => Strategy> = {
  'sma-cross': smaCross,
  breakout,
  rsi: rsiStrategy,
  momentum,
  'mean-reversion': meanReversion,
}

export const isStrategyName = (value: string | undefined): value is StrategyName =>
  (STRATEGY_NAMES as readonly (string | undefined)[]).includes(value)

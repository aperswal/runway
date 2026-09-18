import { z } from 'zod'
import { fetchDailyBars, type BarSource } from './bars.ts'
import { simulate, type Exits, type Report } from './engine.ts'
import { pairs, xsMomentum, type Leg } from './portfolio.ts'
import {
  DEFAULT_PARAMS,
  PORTFOLIO_STRATEGY_NAMES,
  STRATEGIES,
  STRATEGY_NAMES,
  isPortfolioStrategyName,
  isStrategyName,
  type Bar,
  type PortfolioStrategyName,
  type StrategyName,
  type StrategyParams,
} from './strategies.ts'

const DEFAULT_DAYS = 365
const NO_EXIT = Number.POSITIVE_INFINITY
const FLAG_PREFIX = '--'
const NUMERIC_PARAMS = [
  'fast',
  'slow',
  'lookback',
  'period',
  'low',
  'high',
  'entry',
  'exit',
  'top',
  'rebalance',
] as const
const pairSchema = z.tuple([z.string(), z.string()])

export type Flags = Record<string, string>

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {}
  argv.forEach((arg, i) => {
    if (arg.startsWith(FLAG_PREFIX)) {
      const next = argv[i + 1]
      flags[arg.slice(FLAG_PREFIX.length)] =
        next !== undefined && !next.startsWith(FLAG_PREFIX) ? next : 'true'
    }
  })
  return flags
}

export const USAGE = `usage: backtest --symbols AAPL,MSFT --strategy <${[...STRATEGY_NAMES, ...PORTFOLIO_STRATEGY_NAMES].join('|')}> [--days ${DEFAULT_DAYS}] [--fast 10 --slow 50 | --lookback 20 | --period 14 --low 30 --high 70 | --entry 2 --exit 0.5 | --top 3 --rebalance 20] [--stop-pct 5] [--target-pct 10]; pairs needs exactly two symbols`

const numberFlag = (flags: Flags, key: string, fallback: number): number => {
  const raw = flags[key]
  return raw === undefined ? fallback : Number(raw)
}

export async function runBacktest(
  flags: Flags,
  source: BarSource,
  now: Date,
): Promise<Report[] | string> {
  const symbols = (flags.symbols ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0)
  const exits = {
    stopPct: numberFlag(flags, 'stop-pct', NO_EXIT),
    targetPct: numberFlag(flags, 'target-pct', NO_EXIT),
  }
  const run = resolve(flags.strategy, symbols, exits)
  if (run === null) {
    return USAGE
  }
  const params = Object.fromEntries(
    NUMERIC_PARAMS.map((key) => [key, numberFlag(flags, key, DEFAULT_PARAMS[key])]),
  ) as StrategyParams
  const bars = await fetchDailyBars(source, symbols, numberFlag(flags, 'days', DEFAULT_DAYS), now)
  return run(bars, params)
}

type Bars = Record<string, Bar[]>
type Runner = (bars: Bars, params: StrategyParams) => Report[]

const leg = (symbol: string, bars: Bars): Leg => ({ symbol, bars: bars[symbol] ?? [] })

const singleRunner =
  (name: StrategyName, symbols: string[], exits: Exits): Runner =>
  (bars, params) => {
    const strategy = STRATEGIES[name](params)
    return symbols.map((symbol) => simulate(symbol, leg(symbol, bars).bars, strategy, exits))
  }

const pairsRunner =
  (pair: [string, string]): Runner =>
  (bars, params) => [pairs(leg(pair[0], bars), leg(pair[1], bars), params)]

const xsMomentumRunner =
  (symbols: string[]): Runner =>
  (bars, params) => [
    xsMomentum(Object.fromEntries(symbols.map((s) => [s, leg(s, bars).bars])), params),
  ]

function portfolioRunner(name: PortfolioStrategyName, symbols: string[]): Runner | null {
  if (name === 'xs-momentum') {
    return xsMomentumRunner(symbols)
  }
  const pair = pairSchema.safeParse(symbols)
  return pair.success ? pairsRunner(pair.data) : null
}

function resolve(name: string | undefined, symbols: string[], exits: Exits): Runner | null {
  if (symbols.length === 0) {
    return null
  }
  if (isPortfolioStrategyName(name)) {
    return portfolioRunner(name, symbols)
  }
  return isStrategyName(name) ? singleRunner(name, symbols, exits) : null
}

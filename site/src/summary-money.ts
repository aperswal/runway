import {
  accrueCosts,
  apiCostBetween,
  breakdown,
  fixedMonthlyUsd,
  xPostTimes,
  type CostBreakdown,
  type CostPoint,
  type CostRates,
} from './costs'
import type { Db } from './db/client'
import type { Distribution } from './db/schema'
import { listDistributions } from './distributions'
import { percentChange, type Horizon, type Point } from './horizons'
import { PERIOD_DAYS } from './period'
import type { Loaded } from './summary'

export type SummaryOptions = { rates: CostRates; payoutFraction: number }

type PeriodSummary = {
  startedAt: string | null
  endsAt: string | null
  startEquity: number
  returnUsd: number
  returnPct: number | null
  daysLeft: number
  costs: CostBreakdown
  netUsd: number
  surviving: boolean
}

type AllTime = { returnUsd: number; costsUsd: number; netUsd: number }

export type Money = {
  subscriptionUsd: number
  monthlyCostUsd: number
  runwayMonths: number
  since: { at: string; equity: number } | null
  allTime: AllTime
  period: PeriodSummary
  window: { costs: CostBreakdown; series: CostPoint[] }
  payouts: {
    fraction: number
    totalUsd: number
    capitalAfterPayoutsUsd: number
    history: Distribution[]
  }
}

type Frame = { equity: number; series: Point[]; horizon: Horizon; now: Date }

const AVERAGE_MONTH_DAYS = 30.4375
const DAY_MS = 86_400_000

export async function moneySummary(
  db: Db,
  options: SummaryOptions,
  loaded: Loaded,
  frame: Frame,
): Promise<Money> {
  const [history, period, window] = await Promise.all([
    listDistributions(db),
    periodSummary(db, options.rates, loaded, frame),
    windowCosts(db, options.rates, frame),
  ])
  const totalUsd = history.reduce((sum, d) => sum + d.payoutUsd, 0)
  const allTime = await allTimeSummary(db, options.rates, loaded, { frame, payoutsUsd: totalUsd })
  return {
    subscriptionUsd: options.rates.subscriptionUsd,
    monthlyCostUsd: fixedMonthlyUsd(options.rates),
    runwayMonths: Math.max(0, allTime.netUsd) / fixedMonthlyUsd(options.rates),
    since:
      loaded.first === undefined ? null : { at: loaded.first.takenAt, equity: loaded.first.equity },
    allTime,
    period,
    window,
    payouts: {
      fraction: options.payoutFraction,
      totalUsd,
      capitalAfterPayoutsUsd: frame.equity - totalUsd,
      history,
    },
  }
}

async function allTimeSummary(
  db: Db,
  rates: CostRates,
  loaded: Loaded,
  input: { frame: Frame; payoutsUsd: number },
): Promise<AllTime> {
  const first = loaded.first
  if (first === undefined) {
    return { returnUsd: 0, costsUsd: 0, netUsd: 0 }
  }
  const returnUsd = input.frame.equity - first.equity + input.payoutsUsd
  const costs = await costsSince(db, rates, first.takenAt, input.frame.now)
  return { returnUsd, costsUsd: costs.totalUsd, netUsd: returnUsd - costs.totalUsd }
}

type Span = { start: string | null; end: string | null; daysLeft: number; elapsed: number }

const UNSTARTED: Span = { start: null, end: null, daysLeft: PERIOD_DAYS, elapsed: 0 }

const periodPosts = (db: Db, start: string | null, now: Date): Promise<string[]> =>
  start === null ? Promise.resolve([]) : xPostTimes(db, start, now.toISOString())

async function periodSummary(
  db: Db,
  rates: CostRates,
  loaded: Loaded,
  frame: Frame,
): Promise<PeriodSummary> {
  const span: Span = loaded.period ?? UNSTARTED
  const startEquity = loaded.periodStartEquity ?? frame.equity
  const returnUsd = frame.equity - startEquity
  const posts = await periodPosts(db, span.start, frame.now)
  const costs = breakdown(rates, span.elapsed, posts.length, loaded.periodCostUsd)
  return {
    startedAt: span.start,
    endsAt: span.end,
    startEquity,
    returnUsd,
    returnPct: percentChange(startEquity, frame.equity),
    daysLeft: span.daysLeft,
    costs,
    netUsd: returnUsd - costs.totalUsd,
    surviving: returnUsd >= rates.subscriptionUsd,
  }
}

const monthsBetween = (fromIso: string, now: Date): number =>
  (now.getTime() - new Date(fromIso).getTime()) / DAY_MS / AVERAGE_MONTH_DAYS

async function costsSince(
  db: Db,
  rates: CostRates,
  fromIso: string,
  now: Date,
): Promise<CostBreakdown> {
  const to = now.toISOString()
  const [posts, apiUsd] = await Promise.all([
    xPostTimes(db, fromIso, to),
    apiCostBetween(db, fromIso, to),
  ])
  return breakdown(rates, monthsBetween(fromIso, now), posts.length, apiUsd)
}

async function windowCosts(db: Db, rates: CostRates, frame: Frame): Promise<Money['window']> {
  const first = frame.series[0]
  if (first === undefined) {
    return { costs: breakdown(rates, 0, 0, 0), series: [] }
  }
  const to = frame.now.toISOString()
  const [posts, apiUsd] = await Promise.all([
    xPostTimes(db, first.takenAt, to),
    apiCostBetween(db, first.takenAt, to),
  ])
  return {
    costs: breakdown(rates, monthsBetween(first.takenAt, frame.now), posts.length, apiUsd),
    series: accrueCosts(frame.series, posts, rates),
  }
}

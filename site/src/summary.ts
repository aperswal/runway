import { asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { type Alpaca } from './alpaca'
import type { Db } from './db/client'
import {
  ACTIVE_STATUSES,
  runs,
  snapshots,
  trades,
  type Fund,
  type HeldPosition,
  type Trade,
} from './db/schema'
import { deployableUsd, drawdown, tier, type Tier } from './allocation'
import { toHeld } from './exits'
import { toHolding, type Holding } from './holdings'
import { listFunds } from './funds'
import {
  HORIZONS,
  baselineEquity,
  frameSeries,
  loadSeries,
  percentChange,
  type Horizon,
  type Point,
} from './horizons'
import { errorMessage, log } from './log'
import { tradeMetrics, type TradeMetrics } from './metrics'
import { periodOf, type Period } from './period'
import { moneySummary, type Money, type SummaryOptions } from './summary-money'

const PERCENT = 100
export const CLOSED_PAGE_SIZE = 10

export type { Holding } from './holdings'

export type Queued = Pick<
  Trade,
  | 'fund'
  | 'symbol'
  | 'qty'
  | 'notional'
  | 'limitPrice'
  | 'expiresAt'
  | 'stop'
  | 'target'
  | 'horizon'
  | 'reason'
  | 'openedAt'
>

type FundSummary = {
  id: string
  name: string
  status: Fund['status']
  mandate: string
  capUsd: number
  capitalUsd: number
  highWaterUsd: number
  drawdownPct: number
  tier: Tier
  rescues: number
  deployedUsd: number
  unrealizedPl: number
  openCount: number
  metrics: TradeMetrics
}

export type SummaryQuery = { horizon: Horizon; closedPage: number; now: Date }

export type Summary = {
  generatedAt: string
  equity: number
  cash: number
  horizon: Horizon
  horizons: { label: Horizon; pct: number | null; baseline: number | null }[]
  series: Point[]
  charts: Record<Horizon, Point[]>
  holdings: Holding[]
  queued: Queued[]
  funds: FundSummary[]
  metrics: TradeMetrics
  money: Money
  closedTrades: Trade[]
  closedPage: { page: number; pages: number }
  lastRun: { finishedAt: string; summary: string; costUsd: number } | null
}

type Latest = { equity: number; cash: number; positions: HeldPosition[] }

export type Loaded = {
  latest: Latest | undefined
  first: { equity: number; takenAt: string } | undefined
  period: Period | undefined
  periodStartEquity: number | undefined
  active: Trade[]
  closed: Trade[]
  periodCostUsd: number
  funds: Fund[]
  lastRun: Summary['lastRun']
}

async function liveLatest(
  alpaca: Alpaca,
  fallback: Latest | undefined,
): Promise<Latest | undefined> {
  try {
    const [account, positions] = await Promise.all([alpaca.account(), alpaca.positions()])
    return { equity: account.equity, cash: account.cash, positions: positions.map(toHeld) }
  } catch (error) {
    log.error({
      message: 'live account unavailable, using last snapshot',
      error: errorMessage(error),
    })
    return fallback
  }
}

function firstSnapshot(db: Db): Promise<Loaded['first']> {
  return db
    .select({ equity: snapshots.equity, takenAt: snapshots.takenAt })
    .from(snapshots)
    .orderBy(asc(snapshots.takenAt))
    .limit(1)
    .then(([row]) => row)
}

async function load(
  db: Db,
  alpaca: Alpaca,
  now: Date,
  first: Promise<Loaded['first']>,
): Promise<Loaded> {
  const firstRow = await first
  const period = firstRow === undefined ? undefined : periodOf(firstRow.takenAt, now)
  const periodStart = period?.start ?? now.toISOString()
  const [[snapshot], [periodFirst], active, closed, periodRuns, [lastRun], funds] =
    await Promise.all([
      db.select().from(snapshots).orderBy(desc(snapshots.takenAt)).limit(1),
      db
        .select({ equity: snapshots.equity })
        .from(snapshots)
        .where(gte(snapshots.takenAt, periodStart))
        .orderBy(snapshots.takenAt)
        .limit(1),
      db
        .select()
        .from(trades)
        .where(inArray(trades.status, [...ACTIVE_STATUSES])),
      db.select().from(trades).where(eq(trades.status, 'closed')).orderBy(desc(trades.closedAt)),
      db.select({ costUsd: runs.costUsd }).from(runs).where(gte(runs.startedAt, periodStart)),
      db.select().from(runs).orderBy(desc(runs.finishedAt)).limit(1),
      listFunds(db),
    ])
  return {
    latest: await liveLatest(alpaca, snapshot),
    first: firstRow,
    period,
    periodStartEquity: periodFirst?.equity,
    active,
    closed,
    periodCostUsd: periodRuns.reduce((sum, r) => sum + r.costUsd, 0),
    funds,
    lastRun:
      lastRun === undefined
        ? null
        : { finishedAt: lastRun.finishedAt, summary: lastRun.summary, costUsd: lastRun.costUsd },
  }
}

async function loadCharts(db: Db, now: Date): Promise<Record<Horizon, Point[]>> {
  const entries = await Promise.all(
    HORIZONS.map(async (h) => [h, await loadSeries(db, h, now)] as const),
  )
  return Object.fromEntries(entries) as Record<Horizon, Point[]>
}

type ChartFrame = { now: Date; equity: number; firstAt: string | undefined }

function frameCharts(
  raw: Record<Horizon, Point[]>,
  baselines: (number | undefined)[],
  frame: ChartFrame,
): Record<Horizon, Point[]> {
  return Object.fromEntries(
    HORIZONS.map((label, i) => [
      label,
      frameSeries(raw[label], { ...frame, horizon: label, baseline: baselines[i] }),
    ]),
  ) as Record<Horizon, Point[]>
}

export async function buildSummary(
  db: Db,
  alpaca: Alpaca,
  options: SummaryOptions,
  query: SummaryQuery,
): Promise<Summary> {
  const { now } = query
  const first = firstSnapshot(db)
  const firstEquity = first.then((row) => row?.equity)
  const [loaded, rawCharts, baselines] = await Promise.all([
    load(db, alpaca, now, first),
    loadCharts(db, now),
    Promise.all(HORIZONS.map((label) => baselineEquity(db, label, now, firstEquity))),
  ])
  const equity = loaded.latest?.equity ?? 0
  const framed = frameCharts(rawCharts, baselines, { now, equity, firstAt: loaded.first?.takenAt })
  const series = framed[query.horizon]
  const horizons = HORIZONS.map((label, i) => ({
    label,
    pct: percentChange(baselines[i], equity),
    baseline: baselines[i] ?? null,
  }))
  const held = new Map(loaded.latest?.positions.map((p) => [p.symbol, p]))
  const holdings = loaded.active.filter((t) => t.status === 'open').map((t) => toHolding(t, held))
  const pages = Math.max(1, Math.ceil(loaded.closed.length / CLOSED_PAGE_SIZE))
  const page = Math.min(pages, Math.max(1, query.closedPage))
  return {
    generatedAt: now.toISOString(),
    equity,
    cash: loaded.latest?.cash ?? 0,
    horizon: query.horizon,
    horizons,
    series,
    charts: framed,
    holdings,
    queued: loaded.active.filter((t) => t.status === 'pending'),
    funds: loaded.funds.map((f) => fundSummary(f, holdings, loaded)),
    metrics: tradeMetrics(loaded.closed),
    money: await moneySummary(db, options, loaded, { equity, series, horizon: query.horizon, now }),
    closedTrades: loaded.closed.slice((page - 1) * CLOSED_PAGE_SIZE, page * CLOSED_PAGE_SIZE),
    closedPage: { page, pages },
    lastRun: loaded.lastRun,
  }
}

function fundSummary(fund: Fund, holdings: Holding[], loaded: Loaded): FundSummary {
  const { id, name, status, mandate } = fund
  const mine = holdings.filter((h) => h.fund === id)
  return {
    id,
    name,
    status,
    mandate,
    capUsd: status === 'active' ? deployableUsd(fund, new Date()) : 0,
    capitalUsd: fund.capital,
    highWaterUsd: fund.highWater,
    drawdownPct: drawdown(fund) * PERCENT,
    tier: status === 'active' ? tier(fund, new Date()) : 'shut',
    rescues: fund.rescues,
    deployedUsd: loaded.active.filter((t) => t.fund === id).reduce((sum, t) => sum + t.notional, 0),
    unrealizedPl: mine.reduce((sum, h) => sum + h.unrealizedPl, 0),
    openCount: mine.length,
    metrics: tradeMetrics(loaded.closed.filter((t) => t.fund === id)),
  }
}

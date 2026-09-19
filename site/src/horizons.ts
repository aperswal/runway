import { desc, gte, lte, max, sql } from 'drizzle-orm'
import type { Db } from './db/client'
import { snapshots } from './db/schema'

export const HORIZONS = ['1D', '1W', '1M', '3M', 'ALL'] as const
export type Horizon = (typeof HORIZONS)[number]
type Windowed = Exclude<Horizon, 'ALL'>

const DAY_MS = 86_400_000
const WEEK_DAYS = 7
const MONTH_DAYS = 30
const QUARTER_DAYS = 90
const DATE_LENGTH = 10
const PERCENT = 100

const HORIZON_MS: Record<Windowed, number> = {
  '1D': DAY_MS,
  '1W': WEEK_DAYS * DAY_MS,
  '1M': MONTH_DAYS * DAY_MS,
  '3M': QUARTER_DAYS * DAY_MS,
}

export type Point = { takenAt: string; equity: number }

export const cutoff = (horizon: Windowed, now: Date): string =>
  new Date(now.getTime() - HORIZON_MS[horizon]).toISOString()

export function percentChange(
  baseline: number | undefined,
  latest: number | undefined,
): number | null {
  if (baseline === undefined || latest === undefined || baseline === 0) {
    return null
  }
  return ((latest - baseline) / baseline) * PERCENT
}

const HOUR_LENGTH = 13
const RAW_DAYS = 2
const HOURLY_DAYS = 21

export function bucketLength(spanDays: number): number | null {
  if (spanDays <= RAW_DAYS) {
    return null
  }
  return spanDays <= HOURLY_DAYS ? HOUR_LENGTH : DATE_LENGTH
}

export async function loadSeries(db: Db, horizon: Horizon, now: Date): Promise<Point[]> {
  const where = horizon === 'ALL' ? undefined : gte(snapshots.takenAt, cutoff(horizon, now))
  const [first] = await db
    .select({ takenAt: snapshots.takenAt })
    .from(snapshots)
    .where(where)
    .orderBy(snapshots.takenAt)
    .limit(1)
  if (first === undefined) {
    return []
  }
  const spanDays = (now.getTime() - new Date(first.takenAt).getTime()) / DAY_MS
  const bucket = bucketLength(spanDays)
  if (bucket === null) {
    return db
      .select({ takenAt: snapshots.takenAt, equity: snapshots.equity })
      .from(snapshots)
      .where(where)
      .orderBy(snapshots.takenAt)
  }
  const rows = await db
    .select({ takenAt: max(snapshots.takenAt), equity: snapshots.equity })
    .from(snapshots)
    .where(where)
    .groupBy(sql`substr(${snapshots.takenAt}, 1, ${bucket})`)
    .orderBy(max(snapshots.takenAt))
  return rows.flatMap((r) => (r.takenAt === null ? [] : [{ takenAt: r.takenAt, equity: r.equity }]))
}

export async function baselineEquity(
  db: Db,
  horizon: Horizon,
  now: Date,
  first?: Promise<number | undefined>,
): Promise<number | undefined> {
  if (horizon !== 'ALL') {
    const [before] = await db
      .select({ equity: snapshots.equity })
      .from(snapshots)
      .where(lte(snapshots.takenAt, cutoff(horizon, now)))
      .orderBy(desc(snapshots.takenAt))
      .limit(1)
    if (before !== undefined) {
      return before.equity
    }
  }
  if (first !== undefined) {
    return first
  }
  const [firstRow] = await db
    .select({ equity: snapshots.equity })
    .from(snapshots)
    .orderBy(snapshots.takenAt)
    .limit(1)
  return firstRow?.equity
}

export type Framing = {
  horizon: Horizon
  now: Date
  baseline: number | undefined
  equity: number
  firstAt: string | undefined
}

function leadingPoint(points: Point[], framing: Framing): Point[] {
  const { horizon, now, baseline, firstAt } = framing
  if (horizon === 'ALL' || baseline === undefined || firstAt === undefined) {
    return []
  }
  const start = cutoff(horizon, now)
  const covered = points[0] !== undefined && points[0].takenAt <= start
  return firstAt < start && !covered ? [{ takenAt: start, equity: baseline }] : []
}

export function frameSeries(points: Point[], framing: Framing): Point[] {
  const framed = [...leadingPoint(points, framing), ...points]
  const last = framed.at(-1)
  const nowIso = framing.now.toISOString()
  if (last === undefined || framing.equity <= 0 || last.takenAt >= nowIso) {
    return framed
  }
  return [...framed, { takenAt: nowIso, equity: framing.equity }]
}

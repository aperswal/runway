import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'
import { apiCostBetween, breakdown, xPostTimes, type CostRates } from './costs'
import type { Db } from './db/client'
import { distributions, snapshots, type Distribution } from './db/schema'
import { StateError } from './errors'
import { easternMonth, monthParts, nowIso } from './time'

const MONTH_LENGTH = 7

export const previousMonth = (now: Date): string => {
  const { year, month } = monthParts(easternMonth(now))
  const previous = new Date(Date.UTC(year, month - 1, 0))
  return previous.toISOString().slice(0, MONTH_LENGTH)
}

export const nextMonthStart = (month: string): string => {
  const { year, month: m } = monthParts(month)
  return new Date(Date.UTC(year, m, 1)).toISOString().slice(0, MONTH_LENGTH)
}

export type PayoutRule = { rates: CostRates; payoutFraction: number }

export async function closeMonth(
  db: Db,
  rule: PayoutRule,
  month: string,
): Promise<Distribution | null> {
  const [existing] = await db.select().from(distributions).where(eq(distributions.month, month))
  if (existing !== undefined) {
    return existing
  }
  const from = `${month}-01`
  const to = `${nextMonthStart(month)}-01`
  const [first] = await db
    .select()
    .from(snapshots)
    .where(and(gte(snapshots.takenAt, from), lt(snapshots.takenAt, to)))
    .orderBy(asc(snapshots.takenAt))
    .limit(1)
  if (first === undefined) {
    return null
  }
  const [last] = await db
    .select()
    .from(snapshots)
    .where(lt(snapshots.takenAt, to))
    .orderBy(desc(snapshots.takenAt))
    .limit(1)
  if (last === undefined) {
    throw new StateError(`no snapshot before ${to} although ${first.takenAt} exists`)
  }
  const costs = breakdown(
    rule.rates,
    1,
    (await xPostTimes(db, from, to)).length,
    await apiCostBetween(db, from, to),
  )
  const profitUsd = last.equity - first.equity - costs.totalUsd
  const [row] = await db
    .insert(distributions)
    .values({
      month,
      startEquity: first.equity,
      endEquity: last.equity,
      costsUsd: costs.totalUsd,
      profitUsd,
      payoutUsd: Math.max(0, profitUsd * rule.payoutFraction),
      closedAt: nowIso(),
    })
    .returning()
  return row ?? null
}

export const listDistributions = (db: Db): Promise<Distribution[]> =>
  db.select().from(distributions).orderBy(desc(distributions.month))

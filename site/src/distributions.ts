import { and, asc, desc, eq, gte, lt } from 'drizzle-orm'
import { apiCostBetween, breakdown, xPostTimes, type CostRates } from './costs'
import type { Db } from './db/client'
import { distributions, snapshots, type Distribution } from './db/schema'
import { StateError } from './errors'
import { endedPeriods, periodEnd } from './period'
import { nowIso } from './time'

export type PayoutRule = { rates: CostRates; payoutFraction: number }

export async function closePeriod(
  db: Db,
  rule: PayoutRule,
  period: string,
): Promise<Distribution | null> {
  const [existing] = await db.select().from(distributions).where(eq(distributions.period, period))
  if (existing !== undefined) {
    return existing
  }
  const to = periodEnd(period)
  const [first] = await db
    .select()
    .from(snapshots)
    .where(and(gte(snapshots.takenAt, period), lt(snapshots.takenAt, to)))
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
    (await xPostTimes(db, period, to)).length,
    await apiCostBetween(db, period, to),
  )
  const profitUsd = last.equity - first.equity - costs.totalUsd
  const [row] = await db
    .insert(distributions)
    .values({
      period,
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

export async function closeDuePeriods(db: Db, rule: PayoutRule, now: Date): Promise<void> {
  const [anchor] = await db
    .select({ takenAt: snapshots.takenAt })
    .from(snapshots)
    .orderBy(asc(snapshots.takenAt))
    .limit(1)
  if (anchor === undefined) {
    return
  }
  for (const period of endedPeriods(anchor.takenAt, now)) {
    await closePeriod(db, rule, period)
  }
}

export const listDistributions = (db: Db): Promise<Distribution[]> =>
  db.select().from(distributions).orderBy(desc(distributions.period))

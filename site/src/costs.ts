import { and, asc, eq, gte, lt } from 'drizzle-orm'
import type { Db } from './db/client'
import { posts, runs } from './db/schema'
import type { Config } from './env'

export type CostRates = { subscriptionUsd: number; platformUsd: number; xPostUsd: number }

export const ratesFrom = (config: Config): CostRates => ({
  subscriptionUsd: config.SUBSCRIPTION_USD,
  platformUsd: config.PLATFORM_USD,
  xPostUsd: config.X_POST_USD,
})

export type CostBreakdown = {
  subscriptionUsd: number
  platformUsd: number
  xPostsUsd: number
  apiEquivalentUsd: number
  totalUsd: number
}

const AVERAGE_MONTH_DAYS = 30.4375
const DAY_MS = 86_400_000

export const fixedMonthlyUsd = (rates: CostRates): number =>
  rates.subscriptionUsd + rates.platformUsd
export const fixedDailyUsd = (rates: CostRates): number =>
  fixedMonthlyUsd(rates) / AVERAGE_MONTH_DAYS

export function breakdown(
  rates: CostRates,
  months: number,
  xPosts: number,
  apiUsd: number,
): CostBreakdown {
  const subscriptionUsd = rates.subscriptionUsd * months
  const platformUsd = rates.platformUsd * months
  const xPostsUsd = xPosts * rates.xPostUsd
  return {
    subscriptionUsd,
    platformUsd,
    xPostsUsd,
    apiEquivalentUsd: apiUsd,
    totalUsd: subscriptionUsd + platformUsd + xPostsUsd,
  }
}

export async function xPostTimes(db: Db, fromIso: string, toIso: string): Promise<string[]> {
  const rows = await db
    .select({ at: posts.createdAt })
    .from(posts)
    .where(
      and(
        eq(posts.network, 'x'),
        eq(posts.status, 'posted'),
        gte(posts.createdAt, fromIso),
        lt(posts.createdAt, toIso),
      ),
    )
    .orderBy(asc(posts.createdAt))
  return rows.map((r) => r.at)
}

export async function apiCostBetween(db: Db, fromIso: string, toIso: string): Promise<number> {
  const rows = await db
    .select({ costUsd: runs.costUsd })
    .from(runs)
    .where(and(gte(runs.startedAt, fromIso), lt(runs.startedAt, toIso)))
  return rows.reduce((sum, r) => sum + r.costUsd, 0)
}

export type CostPoint = { takenAt: string; returnUsd: number; costUsd: number }

export function accrueCosts(
  equity: { takenAt: string; equity: number }[],
  xPostsAt: string[],
  rates: CostRates,
): CostPoint[] {
  const first = equity[0]
  if (first === undefined) {
    return []
  }
  const start = new Date(first.takenAt).getTime()
  return equity.map((point) => {
    const elapsedDays = (new Date(point.takenAt).getTime() - start) / DAY_MS
    const postsSoFar = xPostsAt.filter((at) => at <= point.takenAt).length
    return {
      takenAt: point.takenAt,
      returnUsd: point.equity - first.equity,
      costUsd: elapsedDays * fixedDailyUsd(rates) + postsSoFar * rates.xPostUsd,
    }
  })
}

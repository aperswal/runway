import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from './db/client'
import { ACTIVE_STATUSES, funds, trades, type Fund, type Trade } from './db/schema'
import { log } from './log'
import { contractMultiplier } from './symbols'
import { nowIso } from './time'

const RETAINED = 0.8
const CUT_AT = 0.15
const SHUT_AT = 0.3
const HALF = 0.5
const RESEED = 0.5
const PROBATION_DAYS = 14
const RESCUE_COOLDOWN_DAYS = 30
const MAX_RESCUES = 2
const MS_PER_DAY = 86_400_000
const PERCENT = 100
const EPSILON = 1e-9

export type Tier = 'full' | 'half' | 'shut'
type Book = Pick<Fund, 'capital' | 'highWater' | 'rescuedAt' | 'rescues'>

export const drawdown = (fund: Pick<Fund, 'capital' | 'highWater'>): number =>
  fund.highWater <= 0 ? 0 : Math.max(0, 1 - fund.capital / fund.highWater)

const daysSince = (iso: string | null, now: Date): number =>
  iso === null ? Infinity : (now.getTime() - new Date(iso).getTime()) / MS_PER_DAY

const onProbation = (fund: Pick<Fund, 'rescuedAt'>, now: Date): boolean =>
  daysSince(fund.rescuedAt, now) < PROBATION_DAYS

export function tier(fund: Book, now: Date): Tier {
  const dd = drawdown(fund) + EPSILON
  if (dd >= SHUT_AT) {
    return 'shut'
  }
  return dd >= CUT_AT || onProbation(fund, now) ? 'half' : 'full'
}

const FRACTION: Record<Tier, number> = { full: 1, half: HALF, shut: 0 }

export const deployableUsd = (fund: Book, now: Date): number =>
  fund.capital * FRACTION[tier(fund, now)]

export const seed = (share: number, equity: number): number => share * equity

export const realizedPl = (t: Pick<Trade, 'symbol' | 'qty' | 'entryPrice' | 'exitPrice'>): number =>
  ((t.exitPrice ?? t.entryPrice) - t.entryPrice) * t.qty * contractMultiplier(t.symbol)

const grow = (fund: Fund, amount: number): { capital: number; highWater: number } => {
  const capital = fund.capital + amount
  return { capital, highWater: Math.max(fund.highWater, capital) }
}

export async function settleTrade(db: Db, trade: Trade): Promise<void> {
  const active = (await db.select().from(funds)).filter((f) => f.status === 'active')
  const own = active.find((f) => f.id === trade.fund)
  if (own === undefined) {
    return
  }
  const pl = realizedPl(trade)
  const kept = pl > 0 ? pl * RETAINED : pl
  await db.update(funds).set(grow(own, kept)).where(eq(funds.id, own.id))
  const others = active.filter((f) => f.id !== own.id)
  const pool = others.reduce((sum, f) => sum + f.capital, 0)
  const shared = pl - kept
  for (const other of others) {
    const weight = pool > 0 ? other.capital / pool : 1 / others.length
    await db
      .update(funds)
      .set(grow(other, shared * weight))
      .where(eq(funds.id, other.id))
  }
}

const flat = async (db: Db, fund: string): Promise<boolean> =>
  (
    await db
      .select({ id: trades.id })
      .from(trades)
      .where(and(eq(trades.fund, fund), inArray(trades.status, [...ACTIVE_STATUSES])))
      .limit(1)
  ).length === 0

export const rescueAllowed = (fund: Book, now: Date): boolean =>
  fund.rescues < MAX_RESCUES && daysSince(fund.rescuedAt, now) >= RESCUE_COOLDOWN_DAYS

export type Rescue = { fund: string; action: 'reseeded' | 'retired'; capital: number }

export async function rescueFunds(db: Db, now: Date): Promise<Rescue[]> {
  const shut = (await db.select().from(funds)).filter(
    (f) => f.status === 'active' && tier(f, now) === 'shut',
  )
  const actions: Rescue[] = []
  for (const fund of shut) {
    if (!(await flat(db, fund.id))) {
      continue
    }
    if (!rescueAllowed(fund, now)) {
      await db
        .update(funds)
        .set({
          status: 'retired',
          retiredAt: nowIso(),
          retireReason: `shut by a ${Math.round(drawdown(fund) * PERCENT)}% drawdown after ${fund.rescues} rescues`,
        })
        .where(eq(funds.id, fund.id))
      actions.push({ fund: fund.id, action: 'retired', capital: fund.capital })
      continue
    }
    const capital = fund.highWater * RESEED
    await db
      .update(funds)
      .set({ capital, highWater: capital, rescues: fund.rescues + 1, rescuedAt: now.toISOString() })
      .where(eq(funds.id, fund.id))
    actions.push({ fund: fund.id, action: 'reseeded', capital })
  }
  for (const action of actions) {
    log.info({ message: 'fund rescue', ...action })
  }
  return actions
}

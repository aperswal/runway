import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from './db/client'
import { trades, type Trade } from './db/schema'
import { cancelQueued, type QueuedTrade } from './open-trade'
import type { TradeDeps } from './trades'

export const LIQUIDATION_REASON = 'operator liquidation'

export const liquidating = (active: Pick<Trade, 'liquidate' | 'status'>[]): boolean =>
  active.some((t) => t.liquidate && t.status === 'open')

export async function liquidateAll(
  deps: TradeDeps,
): Promise<{ flagged: number; cancelled: number }> {
  const pending = (await deps.db.select().from(trades).where(eq(trades.status, 'pending'))).filter(
    (t): t is QueuedTrade => t.orderId !== null,
  )
  for (const trade of pending) {
    await cancelQueued(deps, trade, LIQUIDATION_REASON)
  }
  const flagged = await deps.db
    .update(trades)
    .set({ liquidate: true })
    .where(and(inArray(trades.status, ['open', 'closing']), eq(trades.liquidate, false)))
    .returning({ id: trades.id })
  return { flagged: flagged.length, cancelled: pending.length }
}

export const liquidationNotice = (db: Db): Promise<boolean> =>
  db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.status, 'open'), eq(trades.liquidate, true)))
    .limit(1)
    .then((rows) => rows.length > 0)

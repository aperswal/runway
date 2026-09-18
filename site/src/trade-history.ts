import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/client'
import { TRADE_STATUSES, trades, type Trade } from './db/schema'

const MAX_HISTORY = 500
const DEFAULT_HISTORY = 100

export const tradeQuery = z.object({
  fund: z.string().optional(),
  status: z.enum(TRADE_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(MAX_HISTORY).default(DEFAULT_HISTORY),
})

export function listTrades(db: Db, q: z.infer<typeof tradeQuery>): Promise<Trade[]> {
  const filters = [
    q.fund === undefined ? undefined : eq(trades.fund, q.fund),
    q.status === undefined ? undefined : eq(trades.status, q.status),
  ].filter((f) => f !== undefined)
  return db
    .select()
    .from(trades)
    .where(and(...filters))
    .orderBy(desc(trades.openedAt), desc(trades.id))
    .limit(q.limit)
}

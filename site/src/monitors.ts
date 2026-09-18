import { and, asc, eq, inArray, lte } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/client'
import { MONITOR_STATUSES, monitors, type Monitor } from './db/schema'
import { requireActiveFund } from './funds'
import { GuardrailError } from './guardrails'
import { nowIso } from './time'

const MAX_SHORT = 120
const MAX_LONG = 1000
const MAX_ARMED_PER_FUND = 20

export const monitorInput = z.object({
  fund: z.string().min(1),
  symbol: z.string().trim().toUpperCase().min(1).max(MAX_SHORT),
  event: z.string().trim().min(1).max(MAX_SHORT),
  eventAt: z.iso.datetime(),
  watch: z.string().trim().min(1).max(MAX_LONG),
})
export type MonitorInput = z.infer<typeof monitorInput>

export const monitorQuery = z.object({
  fund: z.string().optional(),
  status: z.enum(MONITOR_STATUSES).optional(),
})
export type MonitorQuery = z.infer<typeof monitorQuery>

export const resolveInput = z.object({ outcome: z.string().trim().min(1).max(MAX_LONG) })

export async function createMonitor(db: Db, input: MonitorInput, now: Date): Promise<Monitor> {
  await requireActiveFund(db, input.fund)
  const armed = await listMonitors(db, { fund: input.fund, status: 'armed' })
  if (armed.length >= MAX_ARMED_PER_FUND) {
    throw new GuardrailError(
      'too_many_monitors',
      `${input.fund} already has ${MAX_ARMED_PER_FUND} armed monitors; resolve one first`,
    )
  }
  const status = new Date(input.eventAt) <= now ? 'due' : 'armed'
  const [row] = await db
    .insert(monitors)
    .values({ ...input, status, createdAt: now.toISOString() })
    .returning()
  if (row === undefined) {
    throw new RangeError('monitor insert returned nothing')
  }
  return row
}

export function listMonitors(db: Db, q: MonitorQuery): Promise<Monitor[]> {
  return db
    .select()
    .from(monitors)
    .where(
      and(
        q.fund === undefined ? undefined : eq(monitors.fund, q.fund),
        q.status === undefined ? undefined : eq(monitors.status, q.status),
      ),
    )
    .orderBy(asc(monitors.eventAt), asc(monitors.id))
}

export async function markDueMonitors(db: Db, now: Date): Promise<number> {
  const rows = await db
    .update(monitors)
    .set({ status: 'due' })
    .where(and(eq(monitors.status, 'armed'), lte(monitors.eventAt, now.toISOString())))
    .returning({ id: monitors.id })
  return rows.length
}

export async function resolveMonitor(db: Db, id: number, outcome: string): Promise<Monitor> {
  const [row] = await db
    .update(monitors)
    .set({ status: 'done', outcome, doneAt: nowIso() })
    .where(and(eq(monitors.id, id), inArray(monitors.status, ['armed', 'due'])))
    .returning()
  if (row === undefined) {
    throw new GuardrailError('unknown_monitor', `no open monitor ${id}`)
  }
  return row
}

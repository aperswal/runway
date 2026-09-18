import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/client'
import { ACTIVE_STATUSES, funds, trades, type Fund } from './db/schema'
import { seed } from './allocation'
import { GuardrailError } from './guardrails'
import { nowIso } from './time'

const SLUG = /^[a-z][a-z0-9-]{1,23}$/
const MAX_NAME = 60
const MIN_MANDATE = 20
const MAX_MANDATE = 1500
const SHARE_EPSILON = 1e-9
const MAX_REASON = 120
const SHARE_DECIMALS = 2

export const fundInput = z.object({
  id: z.string().regex(SLUG, 'lowercase slug like social-signal'),
  name: z.string().trim().min(1).max(MAX_NAME),
  mandate: z.string().trim().min(MIN_MANDATE).max(MAX_MANDATE),
  share: z.number().positive().max(1),
})

export const shareInput = z.object({ share: z.number().positive().max(1) })
export const retireInput = z.object({
  reason: z.string().trim().min(1).max(MAX_REASON),
})

export type FundInput = z.infer<typeof fundInput>

export const listFunds = (db: Db): Promise<Fund[]> =>
  db.select().from(funds).orderBy(funds.createdAt)

export const activeFunds = async (db: Db): Promise<Fund[]> =>
  (await listFunds(db)).filter((f) => f.status === 'active')

export async function requireActiveFund(db: Db, id: string): Promise<Fund> {
  const [fund] = await db.select().from(funds).where(eq(funds.id, id))
  if (fund === undefined) {
    throw new GuardrailError('unknown_fund', `no fund ${id}`)
  }
  if (fund.status !== 'active') {
    throw new GuardrailError('fund_retired', `${id} was retired ${fund.retiredAt ?? ''}`)
  }
  return fund
}

function assertSharesFit(active: Fund[], changed: string, share: number): void {
  const others = active.filter((f) => f.id !== changed).reduce((sum, f) => sum + f.share, 0)
  if (others + share > 1 + SHARE_EPSILON) {
    const free = Math.max(0, 1 - others)
    throw new GuardrailError(
      'shares_exceeded',
      `only ${free.toFixed(SHARE_DECIMALS)} of equity is unallocated; retire or shrink a fund first`,
    )
  }
}

export async function createFund(db: Db, input: FundInput, equity: number): Promise<Fund> {
  const all = await listFunds(db)
  if (all.some((f) => f.id === input.id)) {
    throw new GuardrailError(
      'fund_exists',
      `${input.id} already exists (retired funds keep their id)`,
    )
  }
  assertSharesFit(
    all.filter((f) => f.status === 'active'),
    input.id,
    input.share,
  )
  const [fund] = await db
    .insert(funds)
    .values({
      ...input,
      capital: seed(input.share, equity),
      highWater: seed(input.share, equity),
      status: 'active',
      createdAt: nowIso(),
    })
    .returning()
  if (fund === undefined) {
    throw new GuardrailError('fund_exists', `${input.id} could not be created`)
  }
  return fund
}

export async function reallocateFund(
  db: Db,
  id: string,
  share: number,
  equity: number,
): Promise<Fund> {
  await requireActiveFund(db, id)
  assertSharesFit(await activeFunds(db), id, share)
  const capital = seed(share, equity)
  const [fund] = await db
    .update(funds)
    .set({ share, capital, highWater: capital })
    .where(eq(funds.id, id))
    .returning()
  if (fund === undefined) {
    throw new GuardrailError('unknown_fund', `no fund ${id}`)
  }
  return fund
}

export async function retireFund(db: Db, id: string, reason: string): Promise<Fund> {
  await requireActiveFund(db, id)
  const open = await db
    .select({ symbol: trades.symbol })
    .from(trades)
    .where(and(eq(trades.fund, id), inArray(trades.status, [...ACTIVE_STATUSES])))
  if (open.length > 0) {
    throw new GuardrailError(
      'fund_has_positions',
      `${id} still holds ${open.map((t) => t.symbol).join(', ')}; close them first`,
    )
  }
  const [fund] = await db
    .update(funds)
    .set({ status: 'retired', retiredAt: nowIso(), retireReason: reason })
    .where(eq(funds.id, id))
    .returning()
  if (fund === undefined) {
    throw new GuardrailError('unknown_fund', `no fund ${id}`)
  }
  return fund
}

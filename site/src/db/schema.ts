import { sql } from 'drizzle-orm'
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export * from './schema-research'

export type HeldPosition = {
  symbol: string
  qty: number
  marketValue: number
  currentPrice: number
  unrealizedPl: number
}

export const TRADE_STATUSES = ['pending', 'open', 'closing', 'closed', 'cancelled'] as const
export type TradeStatus = (typeof TRADE_STATUSES)[number]
export const ACTIVE_STATUSES: readonly TradeStatus[] = ['pending', 'open', 'closing']

export const funds = sqliteTable('funds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mandate: text('mandate').notNull(),
  share: real('share').notNull(),
  capital: real('capital').notNull().default(0),
  highWater: real('high_water').notNull().default(0),
  rescues: integer('rescues').notNull().default(0),
  rescuedAt: text('rescued_at'),
  status: text('status', { enum: ['active', 'retired'] }).notNull(),
  createdAt: text('created_at').notNull(),
  retiredAt: text('retired_at'),
  retireReason: text('retire_reason'),
})

export const snapshots = sqliteTable(
  'snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    takenAt: text('taken_at').notNull(),
    equity: real('equity').notNull(),
    cash: real('cash').notNull(),
    positions: text('positions', { mode: 'json' }).$type<HeldPosition[]>().notNull(),
  },
  (table) => [index('snapshots_taken_at').on(table.takenAt)],
)

export const trades = sqliteTable(
  'trades',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fund: text('fund')
      .notNull()
      .references(() => funds.id),
    symbol: text('symbol').notNull(),
    assetClass: text('asset_class', { enum: ['us_equity', 'crypto', 'us_option'] }).notNull(),
    notional: real('notional').notNull(),
    qty: real('qty').notNull(),
    limitPrice: real('limit_price'),
    entryPrice: real('entry_price').notNull(),
    stop: real('stop').notNull(),
    target: real('target').notNull(),
    trailPct: real('trail_pct'),
    entryStop: real('entry_stop'),
    liquidate: integer('liquidate', { mode: 'boolean' }).notNull().default(false),
    horizon: text('horizon').notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: TRADE_STATUSES }).notNull(),
    orderId: text('order_id'),
    closeOrderId: text('close_order_id'),
    expiresAt: text('expires_at'),
    exitPrice: real('exit_price'),
    exitReason: text('exit_reason'),
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at'),
  },
  (table) => [
    uniqueIndex('trades_one_active_per_fund_symbol')
      .on(table.fund, table.symbol)
      .where(sql`${table.status} in ('pending', 'open', 'closing')`),
    index('trades_status').on(table.status),
    index('trades_closed_at').on(table.closedAt),
  ],
)

export const runs = sqliteTable(
  'runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    trigger: text('trigger').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costUsd: real('cost_usd').notNull(),
    turns: integer('turns').notNull(),
    summary: text('summary').notNull(),
    error: text('error'),
  },
  (table) => [
    index('runs_started_at').on(table.startedAt),
    index('runs_finished_at').on(table.finishedAt),
  ],
)

export const posts = sqliteTable(
  'posts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tradeId: integer('trade_id').notNull(),
    kind: text('kind', { enum: ['buy', 'sell'] }).notNull(),
    network: text('network', { enum: ['x', 'linkedin'] }).notNull(),
    status: text('status', { enum: ['posted', 'failed'] }).notNull(),
    externalId: text('external_id'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('posts_network_status_created_at').on(table.network, table.status, table.createdAt),
  ],
)

export const distributions = sqliteTable('distributions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  period: text('period').notNull().unique(),
  startEquity: real('start_equity').notNull(),
  endEquity: real('end_equity').notNull(),
  costsUsd: real('costs_usd').notNull(),
  profitUsd: real('profit_usd').notNull(),
  payoutUsd: real('payout_usd').notNull(),
  closedAt: text('closed_at').notNull(),
})

export const jobs = sqliteTable(
  'jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fund: text('fund').notNull(),
    name: text('name').notNull(),
    script: text('script').notNull(),
    everyMinutes: integer('every_minutes').notNull(),
    remainingRuns: integer('remaining_runs').notNull(),
    timeoutSeconds: integer('timeout_seconds').notNull(),
    status: text('status', { enum: ['active', 'done', 'cancelled'] }).notNull(),
    nextRunAt: text('next_run_at').notNull(),
    lastRunAt: text('last_run_at'),
    lastOutput: text('last_output'),
    lastExitCode: integer('last_exit_code'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('jobs_status_next_run_at').on(table.status, table.nextRunAt)],
)

export type Fund = typeof funds.$inferSelect
export type Job = typeof jobs.$inferSelect
export type Distribution = typeof distributions.$inferSelect
export type Snapshot = typeof snapshots.$inferSelect
export type Trade = typeof trades.$inferSelect
export type Run = typeof runs.$inferSelect
export type NewRun = typeof runs.$inferInsert

export const managerRuns = sqliteTable('manager_runs', {
  key: text('key').primaryKey(),
  fund: text('fund').notNull(),
  trigger: text('trigger').notNull(),
  outcome: text('outcome'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
})
export type ManagerRun = typeof managerRuns.$inferSelect

export const codexAuth = sqliteTable('codex_auth', {
  id: integer('id').primaryKey(),
  auth: text('auth').notNull(),
  refreshedAt: text('refreshed_at').notNull(),
})

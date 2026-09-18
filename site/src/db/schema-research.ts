import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const ANALYSIS_KINDS = [
  'statistical',
  'technical',
  'fundamental',
  'simulation',
  'consequences',
  'backtest',
  'indicators',
  'strategy',
] as const
export type AnalysisKind = (typeof ANALYSIS_KINDS)[number]
export const VERDICTS = ['adopt', 'reject', 'inconclusive', 'watch'] as const
export type Figures = Record<string, number | string>

export const analyses = sqliteTable(
  'analyses',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fund: text('fund').notNull(),
    kind: text('kind', { enum: ANALYSIS_KINDS }).notNull(),
    symbols: text('symbols'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    figures: text('figures', { mode: 'json' }).$type<Figures>().notNull(),
    verdict: text('verdict', { enum: VERDICTS }),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('analyses_created_at_id').on(table.createdAt, table.id),
    index('analyses_fund').on(table.fund),
    index('analyses_kind').on(table.kind),
  ],
)

export const MONITOR_STATUSES = ['armed', 'due', 'done'] as const

export const monitors = sqliteTable(
  'monitors',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fund: text('fund').notNull(),
    symbol: text('symbol').notNull(),
    event: text('event').notNull(),
    eventAt: text('event_at').notNull(),
    watch: text('watch').notNull(),
    status: text('status', { enum: MONITOR_STATUSES }).notNull(),
    outcome: text('outcome'),
    createdAt: text('created_at').notNull(),
    doneAt: text('done_at'),
  },
  (table) => [index('monitors_status_event_at').on(table.status, table.eventAt)],
)

export const observations = sqliteTable(
  'observations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fund: text('fund').notNull(),
    symbol: text('symbol'),
    source: text('source').notNull(),
    metric: text('metric').notNull(),
    value: real('value'),
    note: text('note').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('observations_fund_created_at').on(table.fund, table.createdAt),
    index('observations_symbol').on(table.symbol),
  ],
)

export const notes = sqliteTable(
  'notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fund: text('fund').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('notes_fund_created_at').on(table.fund, table.createdAt)],
)

export const LESSON_KINDS = ['technical', 'execution', 'psyche'] as const

export const lessons = sqliteTable(
  'lessons',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fund: text('fund').notNull(),
    kind: text('kind', { enum: LESSON_KINDS }).notNull(),
    lesson: text('lesson').notNull(),
    tradeId: integer('trade_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('lessons_fund_created_at').on(table.fund, table.createdAt)],
)

export const PLAIN_KINDS = ['note', 'observation', 'analysis', 'monitor', 'lesson'] as const

export const plain = sqliteTable(
  'plain',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    kind: text('kind', { enum: PLAIN_KINDS }).notNull(),
    sourceId: integer('source_id').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    model: text('model').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('plain_kind_source').on(table.kind, table.sourceId)],
)

export type Analysis = typeof analyses.$inferSelect
export type Monitor = typeof monitors.$inferSelect
export type Lesson = typeof lessons.$inferSelect
export type Observation = typeof observations.$inferSelect
export type Note = typeof notes.$inferSelect

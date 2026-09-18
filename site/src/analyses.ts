import { and, count, desc, eq, like } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/client'
import { ANALYSIS_KINDS, VERDICTS, analyses, type Analysis } from './db/schema'
import { requireActiveFund } from './funds'
import { nowIso } from './time'

const MAX_SHORT = 120
const MAX_BODY = 4000
const MAX_FIGURES = 12
const MAX_FIGURE_TEXT = 40
const MAX_SYMBOLS = 20
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

const symbolList = z
  .array(z.string().trim().toUpperCase().min(1).max(MAX_SHORT))
  .max(MAX_SYMBOLS)
  .nullable()
  .default(null)

export const analysisInput = z.object({
  fund: z.string().min(1),
  kind: z.enum(ANALYSIS_KINDS),
  symbols: symbolList,
  title: z.string().trim().min(1).max(MAX_SHORT),
  body: z.string().trim().min(1).max(MAX_BODY),
  figures: z
    .record(
      z.string().min(1).max(MAX_FIGURE_TEXT),
      z.union([z.number(), z.string().max(MAX_FIGURE_TEXT)]),
    )
    .refine((f) => Object.keys(f).length <= MAX_FIGURES, `at most ${MAX_FIGURES} figures`)
    .default({}),
  verdict: z.enum(VERDICTS).nullable().default(null),
})
export type AnalysisInput = z.infer<typeof analysisInput>

export const analysisQuery = z.object({
  fund: z.string().optional(),
  kind: z.enum(ANALYSIS_KINDS).optional(),
  symbol: z.string().optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().nonnegative().default(0),
})
export type AnalysisQuery = z.infer<typeof analysisQuery>

export async function recordAnalysis(db: Db, input: AnalysisInput): Promise<Analysis> {
  await requireActiveFund(db, input.fund)
  const { symbols, ...rest } = input
  const [row] = await db
    .insert(analyses)
    .values({ ...rest, symbols: symbols === null ? null : symbols.join(','), createdAt: nowIso() })
    .returning()
  if (row === undefined) {
    throw new RangeError('analysis insert returned nothing')
  }
  return row
}

const filters = (q: Omit<AnalysisQuery, 'limit' | 'offset'>) =>
  and(
    q.fund === undefined ? undefined : eq(analyses.fund, q.fund),
    q.kind === undefined ? undefined : eq(analyses.kind, q.kind),
    q.symbol === undefined ? undefined : like(analyses.symbols, `%${q.symbol}%`),
  )

export function listAnalyses(db: Db, q: AnalysisQuery): Promise<Analysis[]> {
  return db
    .select()
    .from(analyses)
    .where(filters(q))
    .orderBy(desc(analyses.createdAt), desc(analyses.id))
    .limit(q.limit)
    .offset(q.offset)
}

export async function countAnalyses(
  db: Db,
  q: Omit<AnalysisQuery, 'limit' | 'offset'>,
): Promise<number> {
  const [row] = await db.select({ n: count() }).from(analyses).where(filters(q))
  return row?.n ?? 0
}

export const symbolsOf = (a: Analysis): string[] =>
  a.symbols === null ? [] : a.symbols.split(',').filter((s) => s !== '')

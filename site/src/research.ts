import { and, count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/client'
import {
  LESSON_KINDS,
  lessons,
  notes,
  observations,
  type Lesson,
  type Note,
  type Observation,
} from './db/schema'
import { requireActiveFund } from './funds'
import { nowIso } from './time'

const MAX_SHORT = 120
const MAX_LONG = 2000
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 500

export const observationInput = z.object({
  fund: z.string().min(1),
  symbol: z.string().trim().toUpperCase().max(MAX_SHORT).nullable().default(null),
  source: z.string().trim().min(1).max(MAX_LONG),
  metric: z.string().trim().min(1).max(MAX_SHORT),
  value: z.number().nullable().default(null),
  note: z.string().trim().min(1).max(MAX_LONG),
})

export const noteInput = z.object({
  fund: z.string().min(1),
  title: z.string().trim().min(1).max(MAX_SHORT),
  body: z.string().trim().min(1).max(MAX_LONG),
})

export const lessonInput = z.object({
  fund: z.string().min(1),
  kind: z.enum(LESSON_KINDS),
  lesson: z.string().trim().min(1).max(MAX_LONG),
  tradeId: z.number().int().positive().nullable().default(null),
})

export const researchQuery = z.object({
  fund: z.string().optional(),
  symbol: z.string().optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.coerce.number().int().nonnegative().default(0),
})

export type ResearchQuery = z.infer<typeof researchQuery>

export async function recordObservation(
  db: Db,
  input: z.infer<typeof observationInput>,
): Promise<Observation> {
  await requireActiveFund(db, input.fund)
  const [row] = await db
    .insert(observations)
    .values({ ...input, createdAt: nowIso() })
    .returning()
  if (row === undefined) {
    throw new RangeError('observation insert returned nothing')
  }
  return row
}

export async function recordNote(db: Db, input: z.infer<typeof noteInput>): Promise<Note> {
  await requireActiveFund(db, input.fund)
  const [row] = await db
    .insert(notes)
    .values({ ...input, createdAt: nowIso() })
    .returning()
  if (row === undefined) {
    throw new RangeError('note insert returned nothing')
  }
  return row
}

export async function recordLesson(db: Db, input: z.infer<typeof lessonInput>): Promise<Lesson> {
  await requireActiveFund(db, input.fund)
  const [row] = await db
    .insert(lessons)
    .values({ ...input, createdAt: nowIso() })
    .returning()
  if (row === undefined) {
    throw new RangeError('lesson insert returned nothing')
  }
  return row
}

export function listLessons(db: Db, q: ResearchQuery): Promise<Lesson[]> {
  return db
    .select()
    .from(lessons)
    .where(q.fund === undefined ? undefined : eq(lessons.fund, q.fund))
    .orderBy(desc(lessons.createdAt), desc(lessons.id))
    .limit(q.limit)
    .offset(q.offset)
}

export function listNotes(db: Db, q: ResearchQuery): Promise<Note[]> {
  return db
    .select()
    .from(notes)
    .where(q.fund === undefined ? undefined : eq(notes.fund, q.fund))
    .orderBy(desc(notes.createdAt), desc(notes.id))
    .limit(q.limit)
    .offset(q.offset)
}

const observationFilter = (q: ResearchQuery) =>
  and(
    q.fund === undefined ? undefined : eq(observations.fund, q.fund),
    q.symbol === undefined ? undefined : eq(observations.symbol, q.symbol.toUpperCase()),
  )

export function listObservations(db: Db, q: ResearchQuery): Promise<Observation[]> {
  return db
    .select()
    .from(observations)
    .where(observationFilter(q))
    .orderBy(desc(observations.createdAt), desc(observations.id))
    .limit(q.limit)
    .offset(q.offset)
}

export async function countResearch(
  db: Db,
  kind: 'notes' | 'observations',
  q: ResearchQuery,
): Promise<number> {
  const rows =
    kind === 'notes'
      ? await db
          .select({ n: count() })
          .from(notes)
          .where(q.fund === undefined ? undefined : eq(notes.fund, q.fund))
      : await db.select({ n: count() }).from(observations).where(observationFilter(q))
  return rows[0]?.n ?? 0
}

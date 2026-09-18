import { count } from 'drizzle-orm'
import type { Db } from './db/client'
import {
  analyses,
  lessons,
  notes,
  observations,
  type Analysis,
  type Fund,
  type Lesson,
  type Note,
  type Observation,
} from './db/schema'
import { listAnalyses } from './analyses'
import { listLessons, listNotes, listObservations } from './research'

const RECENT = 5
const RECENT_LESSONS = 12

export type FundMemory = {
  fund: string
  notes: Note[]
  observations: Observation[]
  analyses: Analysis[]
  lessons: Lesson[]
}

export type Research = {
  noteCount: number
  observationCount: number
  analysisCount: number
  lessonCount: number
  byFund: FundMemory[]
}

async function total(
  db: Db,
  table: typeof notes | typeof observations | typeof analyses | typeof lessons,
): Promise<number> {
  const [row] = await db.select({ total: count() }).from(table)
  return row?.total ?? 0
}

async function memoryOf(db: Db, fund: string): Promise<FundMemory> {
  const q = { fund, limit: RECENT, offset: 0 }
  const [noteRows, observationRows, analysisRows, lessonRows] = await Promise.all([
    listNotes(db, q),
    listObservations(db, q),
    listAnalyses(db, q),
    listLessons(db, { ...q, limit: RECENT_LESSONS }),
  ])
  return {
    fund,
    notes: noteRows,
    observations: observationRows,
    analyses: analysisRows,
    lessons: lessonRows,
  }
}

export async function researchSummary(
  db: Db,
  funds: Pick<Fund, 'id' | 'status'>[],
  only?: string,
): Promise<Research> {
  const [noteCount, observationCount, analysisCount, lessonCount, byFund] = await Promise.all([
    total(db, notes),
    total(db, observations),
    total(db, analyses),
    total(db, lessons),
    Promise.all(
      funds
        .filter((f) => f.status === 'active' && (only === undefined || f.id === only))
        .map((f) => memoryOf(db, f.id)),
    ),
  ])
  return { noteCount, observationCount, analysisCount, lessonCount, byFund }
}

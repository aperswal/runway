import { count } from 'drizzle-orm'
import type { Db } from './db/client'
import { lessons, notes, observations } from './db/schema'
import { listFunds } from './funds'
import {
  notesQuery,
  renderNotes,
  type Entries,
  type Kind,
  type NotesData,
  type NotesQuery,
} from './notes-page'
import { withPlain, type View } from './plain'
import { listLessons, listNotes, listObservations } from './research'
import { buildStats, statsQuery, type StatsQuery } from './stats'
import { renderStats } from './stats-page'

export const PAGE_SIZE = 25
const TABLES = { notes, observations, lessons } as const

export function parseNotesQuery(raw: Record<string, string>): NotesQuery {
  const parsed = notesQuery.safeParse(raw)
  return parsed.success ? parsed.data : { kind: 'notes', page: 1, view: 'plain' }
}

export function parseStatsQuery(raw: Record<string, string>): StatsQuery {
  const parsed = statsQuery.safeParse(raw)
  return parsed.success ? parsed.data : { page: 1, view: 'plain', section: 'analyses' }
}

async function countsByFund(db: Db, kind: Kind): Promise<Map<string, number>> {
  const table = TABLES[kind]
  const rows = await db.select({ fund: table.fund, n: count() }).from(table).groupBy(table.fund)
  return new Map(rows.map((r) => [r.fund, r.n]))
}

async function countOf(db: Db, kind: Kind): Promise<number> {
  const rows = await db.select({ n: count() }).from(TABLES[kind])
  return rows.reduce((sum, row) => sum + row.n, 0)
}

async function kindCounts(db: Db): Promise<Record<Kind, number>> {
  const [n, o, l] = await Promise.all([
    countOf(db, 'notes'),
    countOf(db, 'observations'),
    countOf(db, 'lessons'),
  ])
  return { notes: n, observations: o, lessons: l }
}

export const pageCount = (total: number, size: number): number =>
  Math.max(1, Math.ceil(total / size))

export async function notesPage(db: Db, raw: Record<string, string>, url: string): Promise<string> {
  const query = parseNotesQuery(raw)
  const [counts, allFunds, kindTotals] = await Promise.all([
    countsByFund(db, query.kind),
    listFunds(db),
    kindCounts(db),
  ])
  const funds = allFunds.map((fund) => ({ fund, n: counts.get(fund.id) ?? 0 }))
  const total =
    query.fund === undefined
      ? [...counts.values()].reduce((sum, n) => sum + n, 0)
      : (counts.get(query.fund) ?? 0)
  const pages = pageCount(total, PAGE_SIZE)
  const page = Math.min(query.page, pages)
  const q = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, fund: query.fund }
  const data: NotesData = {
    url,
    query: { ...query, page },
    funds,
    kindTotals,
    total,
    pages,
    entries: await plainEntries(db, await loadEntries(db, query.kind, q), query.view),
  }
  return renderNotes(data)
}

async function plainEntries(db: Db, e: Entries, view: View): Promise<Entries> {
  if (view === 'agent') {
    return e
  }
  if (e.kind === 'notes') {
    const rows = await withPlain(db, 'note', e.rows, (n, t) => ({ ...n, ...t }))
    return { kind: e.kind, rows }
  }
  if (e.kind === 'lessons') {
    const rows = await withPlain(db, 'lesson', e.rows, (l, t) => ({ ...l, lesson: t.body }))
    return { kind: e.kind, rows }
  }
  const rows = await withPlain(db, 'observation', e.rows, (o, t) => ({ ...o, note: t.body }))
  return { kind: e.kind, rows }
}

async function loadEntries(
  db: Db,
  kind: Kind,
  q: { limit: number; offset: number; fund: string | undefined },
): Promise<Entries> {
  if (kind === 'notes') {
    return { kind, rows: await listNotes(db, q) }
  }
  if (kind === 'lessons') {
    return { kind, rows: await listLessons(db, q) }
  }
  return { kind, rows: await listObservations(db, q) }
}

export const statsPage = async (
  db: Db,
  raw: Record<string, string>,
  now: Date,
  url: string,
): Promise<string> => renderStats({ ...(await buildStats(db, parseStatsQuery(raw), now)), url })

import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from './db/client'
import { plain, type PLAIN_KINDS } from './db/schema'

export type PlainKind = (typeof PLAIN_KINDS)[number]
export type PlainText = { title: string; body: string }
export type View = 'plain' | 'agent'

async function loadPlain(db: Db, kind: PlainKind, ids: number[]): Promise<Map<number, PlainText>> {
  if (ids.length === 0) {
    return new Map()
  }
  const rows = await db
    .select({ sourceId: plain.sourceId, title: plain.title, body: plain.body })
    .from(plain)
    .where(and(eq(plain.kind, kind), inArray(plain.sourceId, ids)))
  return new Map(rows.map((r) => [r.sourceId, { title: r.title, body: r.body }]))
}

export async function withPlain<T extends { id: number }>(
  db: Db,
  kind: PlainKind,
  rows: T[],
  apply: (row: T, text: PlainText) => T,
): Promise<T[]> {
  const texts = await loadPlain(
    db,
    kind,
    rows.map((r) => r.id),
  )
  return rows.map((row) => {
    const text = texts.get(row.id)
    return text === undefined ? row : apply(row, text)
  })
}

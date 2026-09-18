import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb } from '../test/helpers'
import { plain } from './db/schema'
import { withPlain } from './plain'

describe('withPlain', () => {
  beforeEach(resetDb)

  it('returns rows untouched when there is nothing to look up', async () => {
    expect(await withPlain(db, 'note', [], () => ({ id: 0 }))).toEqual([])
  })

  it('applies stored plain text only to rows that have it', async () => {
    await db.insert(plain).values([
      { kind: 'note', sourceId: 2, title: 'T', body: 'B', model: 'm', createdAt: 'a' },
      { kind: 'analysis', sourceId: 1, title: 'X', body: 'Y', model: 'm', createdAt: 'a' },
    ])
    const rows = [
      { id: 1, body: 'raw one' },
      { id: 2, body: 'raw two' },
    ]
    expect(await withPlain(db, 'note', rows, (row, t) => ({ ...row, body: t.body }))).toEqual([
      { id: 1, body: 'raw one' },
      { id: 2, body: 'B' },
    ])
  })
})

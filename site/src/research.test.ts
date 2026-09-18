import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb, seedFund, stubDb } from '../test/helpers'
import { notes as notesTable, observations } from './db/schema'
import { GuardrailError } from './guardrails'
import {
  countResearch,
  listNotes,
  listObservations,
  noteInput,
  observationInput,
  recordLesson,
  listLessons,
  recordNote,
  recordObservation,
  researchQuery,
} from './research'

const observation = {
  fund: 'social',
  symbol: 'aapl',
  source: 'https://example.test/reviews',
  metric: 'review_velocity',
  value: 12.5,
  note: 'Reviews doubled week over week',
}
const all = { limit: 50, offset: 0 }

describe('research inputs', () => {
  it('uppercases symbols and defaults nullable fields', () => {
    const parsed = observationInput.parse(observation)
    expect(parsed.symbol).toBe('AAPL')
    const bare = observationInput.parse({ ...observation, symbol: undefined, value: undefined })
    expect(bare.symbol).toBeNull()
    expect(bare.value).toBeNull()
  })
  it('trims observation text and bounds its length', () => {
    const padded = { ...observation, symbol: ' aapl ', source: ' s ', metric: ' m ', note: ' n ' }
    expect(observationInput.parse(padded)).toMatchObject({
      symbol: 'AAPL',
      source: 's',
      metric: 'm',
      note: 'n',
    })
    for (const field of ['source', 'metric', 'note']) {
      expect(observationInput.safeParse({ ...observation, [field]: ' ' }).success).toBe(false)
      expect(
        observationInput.safeParse({ ...observation, [field]: 'x'.repeat(2001) }).success,
      ).toBe(false)
    }
    expect(observationInput.safeParse({ ...observation, metric: 'x'.repeat(121) }).success).toBe(
      false,
    )
    expect(observationInput.safeParse({ ...observation, symbol: 'x'.repeat(121) }).success).toBe(
      false,
    )
  })
  it('defaults and caps the query limit and offset', () => {
    expect(researchQuery.parse({})).toEqual({ limit: 50, offset: 0 })
    expect(researchQuery.parse({ limit: '10', offset: '20', fund: 'social' })).toEqual({
      limit: 10,
      offset: 20,
      fund: 'social',
    })
    expect(researchQuery.safeParse({ limit: '9999' }).success).toBe(false)
    expect(researchQuery.safeParse({ offset: '-1' }).success).toBe(false)
  })
})

describe('research records', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })

  it('records an observation', async () => {
    const row = await recordObservation(db, observationInput.parse(observation))
    expect(row).toMatchObject({ ...observation, symbol: 'AAPL' })
    await expect(
      recordObservation(db, observationInput.parse({ ...observation, fund: 'nope' })),
    ).rejects.toThrow(GuardrailError)
  })

  it('records and lists lessons per fund, newest first', async () => {
    const first = await recordLesson(db, {
      fund: 'social',
      kind: 'execution',
      lesson: 'Queue limit orders before the open.',
      tradeId: 3,
    })
    expect(first).toMatchObject({ fund: 'social', kind: 'execution', tradeId: 3 })
    await recordLesson(db, {
      fund: 'social',
      kind: 'psyche',
      lesson: 'Do not chase.',
      tradeId: null,
    })
    const rows = await listLessons(db, { fund: 'social', limit: 50, offset: 0 })
    expect(rows.map((r) => r.kind)).toEqual(['psyche', 'execution'])
    expect(await listLessons(db, { fund: 'other', limit: 50, offset: 0 })).toEqual([])
    await expect(
      recordLesson(db, { fund: 'nope', kind: 'technical', lesson: 'x', tradeId: null }),
    ).rejects.toThrow()
  })

  it('records and lists notes per fund, newest first, with paging', async () => {
    const first = await recordNote(db, { fund: 'social', title: 'Thesis', body: 'Watching AAPL' })
    expect(first).toMatchObject({ fund: 'social', title: 'Thesis', body: 'Watching AAPL' })
    expect(first.createdAt).toMatch(/Z$/)
    await db
      .insert(notesTable)
      .values({ fund: 'social', title: 'Later', body: 'b', createdAt: '2999-01-01T00:00:00.000Z' })
    await db.insert(notesTable).values({
      fund: 'other',
      title: 'Elsewhere',
      body: 'b',
      createdAt: '2999-01-01T00:00:00.000Z',
    })
    expect((await listNotes(db, { ...all, fund: 'social' })).map((n) => n.title)).toEqual([
      'Later',
      'Thesis',
    ])
    expect((await listNotes(db, { limit: 1, offset: 0 })).map((n) => n.title)).toEqual([
      'Elsewhere',
    ])
    expect((await listNotes(db, { limit: 1, offset: 1 })).map((n) => n.title)).toEqual(['Later'])
    expect(await countResearch(db, 'notes', all)).toBe(3)
    expect(await countResearch(db, 'notes', { ...all, fund: 'social' })).toBe(2)
    await expect(recordNote(db, { fund: 'nope', title: 't', body: 'b' })).rejects.toThrow(
      GuardrailError,
    )
    expect(() => noteInput.parse({ fund: 'social', title: '', body: 'b' })).toThrow()
    expect(noteInput.parse({ fund: 'social', title: ' t ', body: ' b ' })).toEqual({
      fund: 'social',
      title: 't',
      body: 'b',
    })
  })

  it('reports inserts that returned nothing', async () => {
    const fund = { id: 'social', status: 'active' }
    await expect(
      recordNote(stubDb([[fund], []]), { fund: 'social', title: 't', body: 'b' }),
    ).rejects.toThrow('note insert returned nothing')
    await expect(
      recordObservation(stubDb([[fund], []]), observationInput.parse(observation)),
    ).rejects.toThrow('observation insert returned nothing')
    await expect(
      recordLesson(stubDb([[fund], []]), {
        fund: 'social',
        kind: 'psyche',
        lesson: 'x',
        tradeId: null,
      }),
    ).rejects.toThrow('lesson insert returned nothing')
    expect(await countResearch(stubDb([[]]), 'notes', all)).toBe(0)
  })

  it('lists observations filtered by fund and symbol, with paging and counts', async () => {
    const parsed = observationInput.parse(observation)
    await db.insert(observations).values([
      { ...parsed, note: 'a', createdAt: '2026-09-01T00:00:00.000Z' },
      { ...parsed, note: 'b', symbol: 'MSFT', createdAt: '2026-09-02T00:00:00.000Z' },
      { ...parsed, note: 'c', fund: 'supply', createdAt: '2026-09-03T00:00:00.000Z' },
    ])
    const notes = async (q: Parameters<typeof listObservations>[1]): Promise<string[]> =>
      (await listObservations(db, q)).map((o) => o.note)
    expect(await notes(all)).toEqual(['c', 'b', 'a'])
    expect(await notes({ ...all, fund: 'social' })).toEqual(['b', 'a'])
    expect(await notes({ ...all, symbol: 'aapl' })).toEqual(['c', 'a'])
    expect(await notes({ ...all, fund: 'supply', symbol: 'AAPL' })).toEqual(['c'])
    expect(await notes({ limit: 1, offset: 1 })).toEqual(['b'])
    expect(await countResearch(db, 'observations', all)).toBe(3)
    expect(await countResearch(db, 'observations', { ...all, symbol: 'aapl' })).toBe(2)
    expect(await countResearch(stubDb([[]]), 'observations', all)).toBe(0)
  })
})

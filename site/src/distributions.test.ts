import { beforeEach, describe, expect, it } from 'vitest'
import { db, insertSnapshot, resetDb, stubDb } from '../test/helpers'
import { posts, runs } from './db/schema'
import { closeMonth, listDistributions, nextMonthStart, previousMonth } from './distributions'

const rule = {
  rates: { subscriptionUsd: 200, platformUsd: 5, xPostUsd: 0.015 },
  payoutFraction: 0.2,
}

describe('month math', () => {
  it('finds the previous month in eastern time', () => {
    expect(previousMonth(new Date('2026-09-01T05:05:00Z'))).toBe('2026-08')
    expect(previousMonth(new Date('2027-01-01T05:05:00Z'))).toBe('2026-12')
  })
  it('finds the next month start', () => {
    expect(nextMonthStart('2026-12')).toBe('2027-01')
    expect(nextMonthStart('2026-08')).toBe('2026-09')
    expect(nextMonthStart('2026')).toBe('2026-01')
  })
})

describe('closeMonth', () => {
  beforeEach(resetDb)

  it('returns null without snapshots in the month', async () => {
    expect(await closeMonth(db, rule, '2026-08')).toBeNull()
    await insertSnapshot({ takenAt: '2026-09-02T00:00:00.000Z' })
    expect(await closeMonth(db, rule, '2026-08')).toBeNull()
  })

  it('returns null when the only snapshots precede the month', async () => {
    await insertSnapshot({ takenAt: '2026-07-15T00:00:00.000Z' })
    expect(await closeMonth(db, rule, '2026-08')).toBeNull()
  })

  it('pays out a fifth of profit after costs', async () => {
    await insertSnapshot({ takenAt: '2026-07-31T00:00:00.000Z', equity: 500 })
    await insertSnapshot({ takenAt: '2026-08-01T00:00:00.000Z', equity: 1000 })
    await insertSnapshot({ takenAt: '2026-08-31T23:00:00.000Z', equity: 1300 })
    await insertSnapshot({ takenAt: '2026-09-01T00:00:00.000Z', equity: 1400 })
    await db.insert(posts).values([
      {
        tradeId: 1,
        kind: 'buy',
        network: 'x',
        status: 'posted',
        createdAt: '2026-08-02T00:00:00.000Z',
      },
      {
        tradeId: 1,
        kind: 'sell',
        network: 'x',
        status: 'posted',
        createdAt: '2026-08-03T00:00:00.000Z',
      },
    ])
    await db.insert(runs).values({
      trigger: 't',
      startedAt: '2026-08-05T00:00:00.000Z',
      finishedAt: '2026-08-05T00:01:00.000Z',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      costUsd: 3,
      turns: 1,
      summary: 's',
    })
    const row = await closeMonth(db, rule, '2026-08')
    expect(row).toMatchObject({ month: '2026-08', startEquity: 1000, endEquity: 1300 })
    expect(row?.costsUsd).toBeCloseTo(205.03)
    expect(row?.profitUsd).toBeCloseTo(94.97)
    expect(row?.payoutUsd).toBeCloseTo(18.994)
    expect(row?.closedAt).toMatch(/Z$/)
  })

  it('is idempotent', async () => {
    await insertSnapshot({ takenAt: '2026-08-01T00:00:00.000Z', equity: 1000 })
    await insertSnapshot({ takenAt: '2026-08-20T00:00:00.000Z', equity: 900 })
    const first = await closeMonth(db, rule, '2026-08')
    expect(first?.payoutUsd).toBe(0)
    expect(await closeMonth(db, rule, '2026-08')).toEqual(first)
    expect(await listDistributions(db)).toHaveLength(1)
  })

  it('fails loudly when the closing snapshot disappears mid-close', async () => {
    const snap = { takenAt: '2026-08-01T00:00:00.000Z', equity: 1 }
    await expect(closeMonth(stubDb([[], [snap], []]), rule, '2026-08')).rejects.toThrow(
      'no snapshot before 2026-09-01 although 2026-08-01T00:00:00.000Z exists',
    )
  })

  it('returns null when the insert yields nothing', async () => {
    const snap = { takenAt: '2026-08-01T00:00:00.000Z', equity: 1 }
    expect(await closeMonth(stubDb([[], [snap], [snap], [], [], []]), rule, '2026-08')).toBeNull()
  })

  it('lists distributions newest first', async () => {
    await insertSnapshot({ takenAt: '2026-07-01T00:00:00.000Z', equity: 1 })
    await insertSnapshot({ takenAt: '2026-08-01T00:00:00.000Z', equity: 1 })
    await closeMonth(db, rule, '2026-07')
    await closeMonth(db, rule, '2026-08')
    expect((await listDistributions(db)).map((d) => d.month)).toEqual(['2026-08', '2026-07'])
  })
})

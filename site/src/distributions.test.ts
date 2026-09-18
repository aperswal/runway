import { beforeEach, describe, expect, it } from 'vitest'
import { db, insertSnapshot, resetDb, stubDb } from '../test/helpers'
import { distributions, posts, runs } from './db/schema'
import { closeDuePeriods, closePeriod, listDistributions } from './distributions'

const rule = {
  rates: { subscriptionUsd: 200, platformUsd: 5, xPostUsd: 0.015 },
  payoutFraction: 0.2,
}
const p1 = '2026-08-01T00:00:00.000Z'
const p2 = '2026-08-31T00:00:00.000Z'

describe('closePeriod', () => {
  beforeEach(resetDb)

  it('returns null without snapshots in the period', async () => {
    expect(await closePeriod(db, rule, p1)).toBeNull()
    await insertSnapshot({ takenAt: '2026-09-02T00:00:00.000Z' })
    expect(await closePeriod(db, rule, p1)).toBeNull()
    await insertSnapshot({ takenAt: '2026-07-15T00:00:00.000Z' })
    expect(await closePeriod(db, rule, p1)).toBeNull()
  })

  it('pays out a fifth of profit after a full period of costs', async () => {
    await insertSnapshot({ takenAt: '2026-07-31T00:00:00.000Z', equity: 500 })
    await insertSnapshot({ takenAt: p1, equity: 1000 })
    await insertSnapshot({ takenAt: '2026-08-30T23:00:00.000Z', equity: 1300 })
    await insertSnapshot({ takenAt: p2, equity: 1400 })
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
    const row = await closePeriod(db, rule, p1)
    expect(row).toMatchObject({ period: p1, startEquity: 1000, endEquity: 1300 })
    expect(row?.costsUsd).toBeCloseTo(205.03)
    expect(row?.profitUsd).toBeCloseTo(94.97)
    expect(row?.payoutUsd).toBeCloseTo(18.994)
    expect(row?.closedAt).toMatch(/Z$/)
  })

  it('is idempotent', async () => {
    await insertSnapshot({ takenAt: p1, equity: 1000 })
    await insertSnapshot({ takenAt: '2026-08-20T00:00:00.000Z', equity: 900 })
    const first = await closePeriod(db, rule, p1)
    expect(first?.payoutUsd).toBe(0)
    expect(await closePeriod(db, rule, p1)).toEqual(first)
    expect(await listDistributions(db)).toHaveLength(1)
  })

  it('fails loudly when the closing snapshot disappears mid-close', async () => {
    const snap = { takenAt: p1, equity: 1 }
    await expect(closePeriod(stubDb([[], [snap], []]), rule, p1)).rejects.toThrow(
      `no snapshot before ${p2} although ${p1} exists`,
    )
  })

  it('returns null when the insert yields nothing', async () => {
    const snap = { takenAt: p1, equity: 1 }
    expect(await closePeriod(stubDb([[], [snap], [snap], [], [], []]), rule, p1)).toBeNull()
  })

  it('lists distributions newest first', async () => {
    await insertSnapshot({ takenAt: p1, equity: 1 })
    await insertSnapshot({ takenAt: p2, equity: 1 })
    await closePeriod(db, rule, p1)
    await closePeriod(db, rule, p2)
    expect((await listDistributions(db)).map((d) => d.period)).toEqual([p2, p1])
  })
})

describe('closeDuePeriods', () => {
  beforeEach(resetDb)

  it('does nothing without snapshots or before the first period ends', async () => {
    await closeDuePeriods(db, rule, new Date('2026-12-01T00:00:00.000Z'))
    await insertSnapshot({ takenAt: p1, equity: 1000 })
    await closeDuePeriods(db, rule, new Date('2026-08-30T23:59:59.000Z'))
    expect(await db.select().from(distributions)).toEqual([])
  })

  it('closes every ended period once, anchored on the first snapshot', async () => {
    await insertSnapshot({ takenAt: p1, equity: 1000 })
    await insertSnapshot({ takenAt: p2, equity: 1500 })
    await insertSnapshot({ takenAt: '2026-09-29T00:00:00.000Z', equity: 1200 })
    await closeDuePeriods(db, rule, new Date('2026-10-01T00:00:00.000Z'))
    await closeDuePeriods(db, rule, new Date('2026-10-01T00:15:00.000Z'))
    expect(await listDistributions(db)).toMatchObject([
      { period: p2, startEquity: 1500, endEquity: 1200, payoutUsd: 0 },
      { period: p1, startEquity: 1000, endEquity: 1000 },
    ])
  })
})

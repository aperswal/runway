import { beforeEach, describe, expect, it } from 'vitest'
import { TEST_CONFIG, db, resetDb } from '../test/helpers'
import {
  accrueCosts,
  apiCostBetween,
  breakdown,
  fixedDailyUsd,
  fixedMonthlyUsd,
  ratesFrom,
  xPostTimes,
} from './costs'
import { posts, runs } from './db/schema'
import { parseConfig } from './env'

const rates = { subscriptionUsd: 200, platformUsd: 5, xPostUsd: 0.01 }

describe('cost math', () => {
  it('derives rates from config', () => {
    expect(ratesFrom(parseConfig(TEST_CONFIG))).toEqual({
      subscriptionUsd: 200,
      platformUsd: 5,
      xPostUsd: 0.015,
    })
  })

  it('sums fixed costs per month and per day', () => {
    expect(fixedMonthlyUsd(rates)).toBe(205)
    expect(fixedDailyUsd(rates)).toBeCloseTo(205 / 30.4375)
  })

  it('breaks costs down and excludes api-equivalent spend from the total', () => {
    expect(breakdown(rates, 0.5, 3, 7)).toEqual({
      subscriptionUsd: 100,
      platformUsd: 2.5,
      xPostsUsd: 0.03,
      apiEquivalentUsd: 7,
      totalUsd: 102.53,
    })
  })

  it('accrues nothing without equity points', () => {
    expect(accrueCosts([], [], rates)).toEqual([])
  })

  it('accrues fixed costs by elapsed time and x posts by count', () => {
    const equity = [
      { takenAt: '2026-09-01T00:00:00.000Z', equity: 1000 },
      { takenAt: '2026-09-02T00:00:00.000Z', equity: 1010 },
    ]
    const points = accrueCosts(
      equity,
      ['2026-09-01T12:00:00.000Z', '2026-09-02T00:00:00.000Z', '2026-09-03T00:00:00.000Z'],
      rates,
    )
    expect(points[0]).toEqual({ takenAt: '2026-09-01T00:00:00.000Z', returnUsd: 0, costUsd: 0 })
    expect(points[1]?.returnUsd).toBe(10)
    expect(points[1]?.costUsd).toBeCloseTo(205 / 30.4375 + 0.02)
  })
})

describe('cost queries', () => {
  beforeEach(resetDb)

  it('lists posted x post times in range', async () => {
    await db.insert(posts).values([
      {
        tradeId: 1,
        kind: 'buy',
        network: 'x',
        status: 'posted',
        createdAt: '2026-09-02T00:00:00.000Z',
      },
      {
        tradeId: 1,
        kind: 'buy',
        network: 'x',
        status: 'posted',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      {
        tradeId: 1,
        kind: 'buy',
        network: 'x',
        status: 'failed',
        createdAt: '2026-09-03T00:00:00.000Z',
      },
      {
        tradeId: 1,
        kind: 'buy',
        network: 'linkedin',
        status: 'posted',
        createdAt: '2026-09-04T00:00:00.000Z',
      },
      {
        tradeId: 1,
        kind: 'buy',
        network: 'x',
        status: 'posted',
        createdAt: '2026-10-01T00:00:00.000Z',
      },
    ])
    expect(await xPostTimes(db, '2026-09-01', '2026-10-01')).toEqual([
      '2026-09-01T00:00:00.000Z',
      '2026-09-02T00:00:00.000Z',
    ])
  })

  it('sums api cost of runs started in range', async () => {
    const run = {
      trigger: 'cron',
      finishedAt: '2026-09-01T00:10:00.000Z',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      turns: 1,
      summary: 's',
    }
    await db.insert(runs).values([
      { ...run, startedAt: '2026-09-01T00:00:00.000Z', costUsd: 1.5 },
      { ...run, startedAt: '2026-09-15T00:00:00.000Z', costUsd: 2 },
      { ...run, startedAt: '2026-10-01T00:00:00.000Z', costUsd: 9 },
    ])
    expect(await apiCostBetween(db, '2026-09-01', '2026-10-01')).toBe(3.5)
  })
})

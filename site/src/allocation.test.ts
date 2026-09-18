import { beforeEach, describe, expect, it } from 'vitest'
import { db, insertTrade, resetDb, seedFund } from '../test/helpers'
import {
  deployableUsd,
  drawdown,
  realizedPl,
  rescueAllowed,
  rescueFunds,
  seed,
  settleTrade,
  tier,
} from './allocation'
import { funds } from './db/schema'

const now = new Date('2026-09-15T12:00:00.000Z')
const book = (
  capital: number,
  highWater: number,
  rescuedAt: string | null = null,
  rescues = 0,
) => ({
  capital,
  highWater,
  rescuedAt,
  rescues,
})

describe('allocation policy', () => {
  it('measures drawdown from the high water mark', () => {
    expect(drawdown(book(100, 100))).toBe(0)
    expect(drawdown(book(90, 100))).toBeCloseTo(0.1)
    expect(drawdown(book(120, 100))).toBe(0)
    expect(drawdown(book(0, 0))).toBe(0)
  })

  it('cuts deployable capital in tiers and during probation', () => {
    expect(tier(book(100, 100), now)).toBe('full')
    expect(tier(book(85.5, 100), now)).toBe('full')
    expect(tier(book(85, 100), now)).toBe('half')
    expect(tier(book(70.5, 100), now)).toBe('half')
    expect(tier(book(70, 100), now)).toBe('shut')
    expect(tier(book(100, 100, '2026-09-10T00:00:00.000Z'), now)).toBe('half')
    expect(tier(book(100, 100, '2026-08-01T00:00:00.000Z'), now)).toBe('full')
    expect(deployableUsd(book(200, 200), now)).toBe(200)
    expect(deployableUsd(book(170, 200), now)).toBe(85)
    expect(deployableUsd(book(140, 200), now)).toBe(0)
    expect(seed(0.2, 1000)).toBe(200)
  })

  it('allows at most two rescues, a month apart', () => {
    expect(rescueAllowed(book(0, 100), now)).toBe(true)
    expect(rescueAllowed(book(0, 100, '2026-09-01T00:00:00.000Z', 1), now)).toBe(false)
    expect(rescueAllowed(book(0, 100, '2026-08-01T00:00:00.000Z', 1), now)).toBe(true)
    expect(rescueAllowed(book(0, 100, '2026-08-01T00:00:00.000Z', 2), now)).toBe(false)
  })

  it('values realized profit with the contract multiplier', () => {
    expect(realizedPl({ symbol: 'AAPL', qty: 2, entryPrice: 100, exitPrice: 110 })).toBe(20)
    expect(realizedPl({ symbol: 'AAPL', qty: 2, entryPrice: 100, exitPrice: null })).toBe(0)
    expect(
      realizedPl({ symbol: 'AAPL260918C00190000', qty: 1, entryPrice: 1, exitPrice: 1.5 }),
    ).toBeCloseTo(50)
  })
})

describe('settleTrade', () => {
  beforeEach(resetDb)

  it('keeps most of a gain, shares the rest with the other funds, and takes losses in full', async () => {
    await seedFund({ id: 'a', capital: 100, highWater: 100 })
    await seedFund({ id: 'b', capital: 300, highWater: 300 })
    await seedFund({ id: 'c', capital: 100, highWater: 100 })
    await seedFund({ id: 'old', status: 'retired', capital: 50, highWater: 50 })
    const win = await insertTrade({
      fund: 'a',
      symbol: 'AAPL',
      qty: 1,
      entryPrice: 100,
      exitPrice: 110,
      status: 'closed',
    })
    await settleTrade(db, win)
    let rows = Object.fromEntries(
      (await db.select().from(funds)).map((f) => [f.id, [f.capital, f.highWater]]),
    )
    expect(rows.a).toEqual([108, 108])
    expect(rows.b).toEqual([301.5, 301.5])
    expect(rows.c).toEqual([100.5, 100.5])
    expect(rows.old).toEqual([50, 50])
    const loss = await insertTrade({
      fund: 'a',
      symbol: 'MSFT',
      qty: 1,
      entryPrice: 100,
      exitPrice: 80,
      status: 'closed',
    })
    await settleTrade(db, loss)
    rows = Object.fromEntries(
      (await db.select().from(funds)).map((f) => [f.id, [f.capital, f.highWater]]),
    )
    expect(rows.a).toEqual([88, 108])
    expect(rows.b).toEqual([301.5, 301.5])
  })

  it('shares equally when the other funds have no capital and ignores unknown funds', async () => {
    await seedFund({ id: 'a', capital: 100, highWater: 100 })
    await seedFund({ id: 'b', capital: 0, highWater: 0 })
    const win = await insertTrade({
      fund: 'a',
      symbol: 'AAPL',
      qty: 1,
      entryPrice: 100,
      exitPrice: 110,
      status: 'closed',
    })
    await settleTrade(db, win)
    const rows = Object.fromEntries((await db.select().from(funds)).map((f) => [f.id, f.capital]))
    expect(rows).toEqual({ a: 108, b: 2 })
    await seedFund({ id: 'gone', status: 'retired', capital: 10, highWater: 10 })
    const ghost = await insertTrade({
      fund: 'gone',
      symbol: 'GLD',
      qty: 1,
      entryPrice: 1,
      exitPrice: 2,
      status: 'closed',
    })
    await settleTrade(db, ghost)
    expect((await db.select().from(funds)).map((f) => f.capital)).toEqual([108, 2, 10])
  })
})

describe('rescueFunds', () => {
  beforeEach(resetDb)

  it('reseeds a shut fund at half its high water once it is flat, then retires it after two rescues', async () => {
    await seedFund({ id: 'shut', capital: 60, highWater: 100 })
    await seedFund({ id: 'busy', capital: 60, highWater: 100 })
    await insertTrade({ fund: 'busy', symbol: 'AAPL' })
    await seedFund({
      id: 'spent',
      capital: 60,
      highWater: 100,
      rescues: 2,
      rescuedAt: '2026-07-01T00:00:00.000Z',
    })
    await seedFund({ id: 'fine', capital: 100, highWater: 100 })
    const actions = await rescueFunds(db, now)
    expect(actions).toEqual([
      { fund: 'shut', action: 'reseeded', capital: 50 },
      { fund: 'spent', action: 'retired', capital: 60 },
    ])
    const rows = Object.fromEntries((await db.select().from(funds)).map((f) => [f.id, f]))
    expect(rows.shut).toMatchObject({
      capital: 50,
      highWater: 50,
      rescues: 1,
      rescuedAt: now.toISOString(),
    })
    expect(rows.busy).toMatchObject({ capital: 60, rescues: 0 })
    expect(rows.spent).toMatchObject({
      status: 'retired',
      retireReason: 'shut by a 40% drawdown after 2 rescues',
    })
    expect(rows.fine).toMatchObject({ capital: 100 })
    expect(await rescueFunds(db, now)).toEqual([])
  })
})

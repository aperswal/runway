import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb, seedFund } from '../test/helpers'
import { analyses, monitors, type Analysis } from './db/schema'
import { buildStats, statsQuery, toStrategy } from './stats'

const now = new Date('2026-09-15T12:00:00.000Z')
const day = (offset: number): string => new Date(now.getTime() - offset * 86_400_000).toISOString()

const analysis = (over: Partial<Analysis>): typeof analyses.$inferInsert => ({
  fund: 'social',
  kind: 'technical',
  symbols: null,
  title: 't',
  body: 'b',
  figures: {},
  verdict: null,
  createdAt: day(1),
  ...over,
})

describe('statsQuery', () => {
  it('defaults the page and validates kinds', () => {
    expect(statsQuery.parse({})).toEqual({ page: 1, view: 'plain', section: 'analyses' })
    expect(statsQuery.parse({ kind: 'backtest', fund: 'q', symbol: 'A', page: '3' })).toEqual({
      kind: 'backtest',
      fund: 'q',
      symbol: 'A',
      page: 3,
      view: 'plain',
      section: 'analyses',
    })
    expect(statsQuery.safeParse({ kind: 'x' }).success).toBe(false)
    expect(statsQuery.safeParse({ page: '0' }).success).toBe(false)
  })
})

describe('toStrategy', () => {
  const base = { id: 1, fund: 'q', symbols: 'AAPL,MSFT', title: 't', body: 'b', createdAt: day(0) }
  it('needs a numeric return figure and picks up an optional drawdown', () => {
    expect(
      toStrategy({
        ...base,
        kind: 'backtest',
        verdict: 'adopt',
        figures: { 'Return %': 12, 'max drawdown': 4 },
      }),
    ).toEqual({
      id: 1,
      title: 't',
      fund: 'q',
      symbols: ['AAPL', 'MSFT'],
      returnPct: 12,
      drawdownPct: 4,
      verdict: 'adopt',
    })
    expect(
      toStrategy({ ...base, kind: 'backtest', verdict: null, figures: { return: '12%' } }),
    ).toBeNull()
    expect(
      toStrategy({ ...base, kind: 'backtest', verdict: null, figures: { sharpe: 1 } }),
    ).toBeNull()
    expect(
      toStrategy({
        ...base,
        kind: 'backtest',
        verdict: null,
        figures: { return: 3, drawdown: 'n/a' },
      }),
    ).toMatchObject({ returnPct: 3, drawdownPct: null })
  })
})

describe('buildStats', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
    await seedFund({ id: 'quant', name: 'Quant' })
  })
  it('reports an empty market view', async () => {
    expect(await buildStats(db, { page: 1, view: 'plain', section: 'analyses' }, now)).toEqual({
      query: { page: 1, view: 'plain', section: 'analyses' },
      fundNames: { social: 'Social signal', quant: 'Quant' },
      kinds: [
        'statistical',
        'technical',
        'fundamental',
        'simulation',
        'consequences',
        'backtest',
        'indicators',
        'strategy',
      ].map((key) => ({ key, n: 0 })),
      monitors: [],
      strategies: [],
      entries: [],
      total: 0,
      pages: 1,
    })
  })
  it('counts kinds, ranks strategies, lists open monitors and pages the feed', async () => {
    await db.insert(analyses).values([
      analysis({
        title: 'a1',
        kind: 'backtest',
        figures: { return: 5, drawdown: 2 },
        createdAt: day(3),
      }),
      analysis({ title: 'a2', kind: 'strategy', figures: { return: 20 }, createdAt: day(2) }),
      analysis({
        title: 'a3',
        kind: 'backtest',
        figures: { return: -4 },
        fund: 'quant',
        createdAt: day(1),
      }),
      analysis({ title: 'a4', kind: 'backtest', figures: { sharpe: 1 }, createdAt: day(1) }),
      analysis({ title: 'a5', kind: 'consequences', symbols: 'NVDA', createdAt: day(0) }),
    ])
    await db.insert(monitors).values([
      {
        fund: 'social',
        symbol: 'B',
        event: 'earnings',
        eventAt: day(-5),
        watch: 'w',
        status: 'armed',
        createdAt: day(1),
      },
      {
        fund: 'social',
        symbol: 'A',
        event: 'fda',
        eventAt: day(-1),
        watch: 'w',
        status: 'armed',
        createdAt: day(1),
      },
      {
        fund: 'social',
        symbol: 'C',
        event: 'old',
        eventAt: day(2),
        watch: 'w',
        status: 'due',
        createdAt: day(3),
      },
      {
        fund: 'social',
        symbol: 'D',
        event: 'done',
        eventAt: day(2),
        watch: 'w',
        status: 'done',
        createdAt: day(3),
      },
      {
        fund: 'social',
        symbol: 'E',
        event: 'missed',
        eventAt: day(2),
        watch: 'w',
        status: 'armed',
        createdAt: day(3),
      },
      {
        fund: 'social',
        symbol: 'F',
        event: 'x',
        eventAt: day(-9),
        watch: 'w',
        status: 'done',
        createdAt: day(3),
      },
      {
        fund: 'social',
        symbol: 'G',
        event: 'now',
        eventAt: day(0),
        watch: 'w',
        status: 'armed',
        createdAt: day(3),
      },
    ])
    const s = await buildStats(db, { page: 1, view: 'plain', section: 'analyses' }, now)
    expect(s.kinds.filter((k) => k.n > 0)).toEqual([
      { key: 'consequences', n: 1 },
      { key: 'backtest', n: 3 },
      { key: 'strategy', n: 1 },
    ])
    expect(s.strategies.map((x) => [x.title, x.returnPct, x.drawdownPct])).toEqual([
      ['a2', 20, null],
      ['a1', 5, 2],
      ['a3', -4, null],
    ])
    expect(s.monitors.map((m) => m.symbol)).toEqual(['C', 'G', 'A', 'B'])
    expect(s.entries.map((a) => a.title)).toEqual(['a5', 'a4', 'a3', 'a2', 'a1'])
    expect(s.total).toBe(5)
    expect(s.pages).toBe(1)
    const filtered = await buildStats(
      db,
      { page: 9, view: 'plain', section: 'analyses', kind: 'backtest', fund: 'quant' },
      now,
    )
    expect(filtered.entries.map((a) => a.title)).toEqual(['a3'])
    expect(filtered.query).toEqual({
      page: 1,
      view: 'plain',
      section: 'analyses',
      kind: 'backtest',
      fund: 'quant',
    })
    expect(filtered.total).toBe(1)
  })
  it('shows at most eight open monitors', async () => {
    for (let i = 0; i < 9; i += 1) {
      await db.insert(monitors).values({
        fund: 'social',
        symbol: `M${i}`,
        event: 'e',
        eventAt: day(-i - 1),
        watch: 'w',
        status: 'armed',
        createdAt: day(0),
      })
    }
    const s = await buildStats(db, { page: 1, view: 'plain', section: 'analyses' }, now)
    expect(s.monitors).toHaveLength(8)
    expect(s.monitors.map((m) => m.symbol)).toEqual([
      'M0',
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'M6',
      'M7',
    ])
  })

  it('pages the feed at 25 and caps the leaderboard at 8', async () => {
    for (let i = 0; i < 27; i += 1) {
      await db
        .insert(analyses)
        .values(
          analysis({ title: `b${i}`, kind: 'backtest', figures: { return: i }, createdAt: day(i) }),
        )
    }
    const first = await buildStats(db, { page: 1, view: 'plain', section: 'analyses' }, now)
    expect(first.entries).toHaveLength(25)
    expect(first.pages).toBe(2)
    expect(first.strategies.map((x) => x.returnPct)).toEqual([26, 25, 24, 23, 22, 21, 20, 19])
    const second = await buildStats(db, { page: 2, view: 'plain', section: 'analyses' }, now)
    expect(second.entries.map((a) => a.title)).toEqual(['b25', 'b26'])
    expect(second.query.page).toBe(2)
  })
})

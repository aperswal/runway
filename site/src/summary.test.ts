import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  db,
  insertSnapshot,
  insertTrade,
  liveRoutes,
  positionJson,
  resetDb,
  seedFund,
  stubDb,
  stubFetch,
  testEnv,
} from '../test/helpers'
import { distributions, analyses, observations, posts, runs, type Fund } from './db/schema'
import { buildDeps } from './deps'
import { buildSummary, CLOSED_PAGE_SIZE } from './summary'
import { researchSummary } from './summary-research'

const options = {
  rates: { subscriptionUsd: 200, platformUsd: 5, xPostUsd: 0.01 },
  payoutFraction: 0.2,
}
const now = new Date('2026-09-15T12:00:00Z')
const { alpaca } = buildDeps(testEnv())
const query = (horizon: '1D' | '1W' | '1M' | '3M' | 'ALL', closedPage = 1) => ({
  horizon,
  closedPage,
  now,
})

describe('buildSummary', () => {
  beforeEach(resetDb)
  afterEach(() => vi.unstubAllGlobals())

  it('describes an empty account when the broker is unreachable', async () => {
    stubFetch([])
    const s = await buildSummary(db, alpaca, options, query('1W'))
    expect(s.generatedAt).toBe('2026-09-15T12:00:00.000Z')
    expect(s.equity).toBe(0)
    expect(s.cash).toBe(0)
    expect(s.horizon).toBe('1W')
    expect(s.horizons.map((h) => h.pct)).toEqual([null, null, null, null, null])
    expect(s.series).toEqual([])
    expect(s.charts).toEqual({ '1D': [], '1W': [], '1M': [], '3M': [], ALL: [] })
    expect(s.holdings).toEqual([])
    expect(s.queued).toEqual([])
    expect(s.funds).toEqual([])
    expect(s.metrics.closed).toBe(0)
    expect(s.money.month).toMatchObject({
      startEquity: 0,
      returnUsd: 0,
      returnPct: null,
      daysLeft: 16,
    })
    expect(s.money.window).toEqual({
      costs: { subscriptionUsd: 0, platformUsd: 0, xPostsUsd: 0, apiEquivalentUsd: 0, totalUsd: 0 },
      series: [],
    })
    expect(s.money.allTime).toEqual({ returnUsd: 0, costsUsd: 0, netUsd: 0 })
    expect(s.money.runwayMonths).toBe(0)
    expect(s.money.monthlyCostUsd).toBe(205)
    expect(s.money.payouts).toEqual({
      fraction: 0.2,
      totalUsd: 0,
      capitalAfterPayoutsUsd: 0,
      history: [],
    })
    expect(s.closedTrades).toEqual([])
    expect(s.closedPage).toEqual({ page: 1, pages: 1 })
    expect(s.lastRun).toBeNull()
  })

  it('falls back to the last snapshot when the broker is unreachable', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubFetch([])
    await insertSnapshot({ takenAt: '2026-09-15T11:00:00.000Z', equity: 1050, cash: 950 })
    const s = await buildSummary(db, alpaca, options, query('1D'))
    expect(s.equity).toBe(1050)
    expect(s.cash).toBe(950)
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('live account unavailable, using last snapshot'),
    )
    expect(error).toHaveBeenCalledWith(expect.stringContaining('unexpected fetch'))
  })

  it('marks a month that covers the subscription exactly as surviving', async () => {
    stubFetch([
      {
        url: /\/v2\/account$/,
        body: { equity: '1200', cash: '1200', daytrade_count: 0, pattern_day_trader: false },
      },
      { url: /\/v2\/positions$/, body: [] },
    ])
    await insertSnapshot({ takenAt: '2026-09-01T12:00:00.000Z', equity: 1000 })
    const s = await buildSummary(db, alpaca, options, query('1D'))
    expect(s.money.month).toMatchObject({ returnUsd: 200, surviving: true })
  })

  it('assembles live holdings, funds, money and research', async () => {
    stubFetch([
      {
        url: /\/v2\/account$/,
        body: { equity: '1100', cash: '700', daytrade_count: 0, pattern_day_trader: false },
      },
      {
        url: /\/v2\/positions$/,
        body: [
          positionJson({ currentPrice: '220', marketValue: '110', unrealizedPl: '10' }),
          positionJson({
            symbol: 'NVDA260116C00150000',
            qty: '1',
            avgEntryPrice: '3',
            currentPrice: '3.5',
            marketValue: '350',
            unrealizedPl: '50',
            assetClass: 'us_option',
          }),
        ],
      },
    ])
    await seedFund()
    await seedFund({
      id: 'old',
      name: 'Old',
      status: 'retired',
      share: 0.2,
      capital: 0,
      highWater: 0,
      rescues: 0,
      rescuedAt: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    })
    await insertSnapshot({ takenAt: '2026-08-31T12:00:00.000Z', equity: 900, cash: 900 })
    await insertSnapshot({ takenAt: '2026-09-01T12:00:00.000Z', equity: 1000, cash: 800 })
    await insertSnapshot({ takenAt: '2026-09-15T11:00:00.000Z', equity: 1090, cash: 700 })
    await insertTrade({ symbol: 'AAPL' })
    await insertTrade({
      symbol: 'BTC/USD',
      assetClass: 'crypto',
      notional: 50,
      qty: 0.001,
      entryPrice: 50000,
    })
    await insertTrade({ symbol: 'MSFT', status: 'pending', qty: 2, notional: 25, limitPrice: 12.5 })
    await insertTrade({
      symbol: 'NVDA260116C00150000',
      assetClass: 'us_option',
      notional: 300,
      qty: 1,
      entryPrice: 3,
    })
    await insertTrade({
      symbol: 'NVDA',
      status: 'closed',
      qty: 1,
      entryPrice: 100,
      exitPrice: 120,
      exitReason: 'target',
      closedAt: '2026-09-10T00:00:00.000Z',
    })
    await insertTrade({
      symbol: 'AMD',
      fund: 'old',
      status: 'closed',
      qty: 1,
      entryPrice: 100,
      exitPrice: 90,
      exitReason: 'stop',
      closedAt: '2026-09-12T00:00:00.000Z',
    })
    await insertTrade({ symbol: 'GONE', status: 'cancelled', exitReason: 'order expired' })
    const run = {
      trigger: 'cron',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      turns: 1,
      summary: 'Bought AAPL',
    }
    await db.insert(runs).values([
      {
        ...run,
        startedAt: '2026-09-02T00:00:00.000Z',
        finishedAt: '2026-09-02T00:05:00.000Z',
        costUsd: 1,
      },
      {
        ...run,
        startedAt: '2026-09-14T00:00:00.000Z',
        finishedAt: '2026-09-14T00:05:00.000Z',
        costUsd: 2,
      },
      {
        ...run,
        startedAt: '2026-08-14T00:00:00.000Z',
        finishedAt: '2026-08-14T00:05:00.000Z',
        costUsd: 5,
      },
    ])
    await db.insert(posts).values([
      {
        tradeId: 1,
        kind: 'buy',
        network: 'x',
        status: 'posted',
        createdAt: '2026-09-03T00:00:00.000Z',
      },
      {
        tradeId: 1,
        kind: 'buy',
        network: 'x',
        status: 'posted',
        createdAt: '2026-08-20T00:00:00.000Z',
      },
    ])
    await db.insert(distributions).values({
      month: '2026-08',
      startEquity: 800,
      endEquity: 900,
      costsUsd: 50,
      profitUsd: 50,
      payoutUsd: 10,
      closedAt: '2026-09-01T05:05:00.000Z',
    })
    await db.insert(analyses).values({
      fund: 'social',
      kind: 'backtest',
      symbols: null,
      title: 'e1',
      body: 'b',
      figures: {},
      verdict: 'adopt',
      createdAt: '2026-09-05T00:00:00.000Z',
    })
    await db.insert(observations).values({
      fund: 'social',
      source: 's',
      metric: 'm',
      note: 'n',
      createdAt: '2026-09-05T00:00:00.000Z',
    })

    const s = await buildSummary(db, alpaca, options, query('1M'))
    expect(s.equity).toBe(1100)
    expect(s.cash).toBe(700)
    expect(s.horizons.find((h) => h.label === 'ALL')?.pct).toBeCloseTo(22.22, 1)
    expect(s.series.map((p) => p.equity)).toEqual([900, 1000, 1090])
    expect(s.charts['1M']).toEqual(s.series)
    expect(s.charts['1D'].map((p) => p.equity)).toEqual([1090])
    expect(s.charts.ALL.map((p) => p.equity)).toEqual([900, 1000, 1090])
    expect(s.holdings).toEqual([
      {
        fund: 'social',
        symbol: 'AAPL',
        qty: 0.5,
        value: 110,
        unrealizedPl: 10,
        entryPrice: 200,
        currentPrice: 220,
        stop: 180,
        target: 240,
        trailPct: null,
        entryStop: null,
        horizon: '2 weeks',
        reason: 'Review velocity is accelerating',
        openedAt: '2026-08-20T14:00:00.000Z',
      },
      expect.objectContaining({
        symbol: 'BTC/USD',
        qty: 0.001,
        value: 50,
        unrealizedPl: 0,
        currentPrice: 50000,
      }),
      expect.objectContaining({
        symbol: 'NVDA260116C00150000',
        qty: 1,
        value: 350,
        unrealizedPl: 50,
        currentPrice: 3.5,
      }),
    ])
    expect(s.queued).toEqual([
      expect.objectContaining({ symbol: 'MSFT', qty: 2, notional: 25, limitPrice: 12.5 }),
    ])
    expect(
      s.funds.map((f) => [
        f.id,
        f.capUsd,
        f.deployedUsd,
        f.unrealizedPl,
        f.openCount,
        f.metrics.closed,
      ]),
    ).toEqual([
      ['old', 0, 0, 0, 0, 1],
      ['social', 500, 475, 60, 3, 1],
    ])
    expect(s.metrics).toMatchObject({ closed: 2, winRate: 50, realizedPl: 10 })
    expect(s.money.subscriptionUsd).toBe(200)
    const months = 15 / 30.4375
    const allTimeCosts = 205 * months + 0.01
    expect(s.money.allTime.returnUsd).toBe(210)
    expect(s.money.allTime.costsUsd).toBeCloseTo(allTimeCosts)
    expect(s.money.allTime.netUsd).toBeCloseTo(210 - allTimeCosts)
    expect(s.money.runwayMonths).toBeCloseTo((210 - allTimeCosts) / 205)
    expect(s.money.month).toMatchObject({
      startEquity: 1000,
      returnUsd: 100,
      returnPct: 10,
      daysLeft: 16,
      surviving: false,
    })
    expect(s.money.month.costs).toEqual({
      subscriptionUsd: 100,
      platformUsd: 2.5,
      xPostsUsd: 0.01,
      apiEquivalentUsd: 3,
      totalUsd: 102.51,
    })
    expect(s.money.month.netUsd).toBeCloseTo(-2.51)
    expect(s.money.window.series).toHaveLength(3)
    expect(s.money.window.costs.apiEquivalentUsd).toBe(3)
    expect(s.money.window.costs.xPostsUsd).toBe(0.01)
    expect(s.money.window.costs.subscriptionUsd).toBeCloseTo(200 * months)
    expect(s.money.payouts).toMatchObject({ totalUsd: 10, capitalAfterPayoutsUsd: 1090 })
    expect(s.money.payouts.history).toHaveLength(1)
    expect(s.closedTrades.map((t) => t.symbol)).toEqual(['AMD', 'NVDA'])
    expect(s.lastRun).toEqual({
      finishedAt: '2026-09-14T00:05:00.000Z',
      summary: 'Bought AAPL',
      costUsd: 2,
    })
  })

  it('clamps negative profit to zero runway and covers the month at the subscription', async () => {
    stubFetch(liveRoutes())
    await insertSnapshot({ takenAt: '2026-09-01T12:00:00.000Z', equity: 1000 })
    await insertSnapshot({ takenAt: '2026-09-14T12:00:00.000Z', equity: 1200 })
    const s = await buildSummary(db, alpaca, options, query('1D'))
    expect(s.equity).toBe(1000)
    expect(s.money.allTime.returnUsd).toBe(0)
    expect(s.money.allTime.netUsd).toBeLessThan(0)
    expect(s.money.runwayMonths).toBe(0)
    expect(s.money.month.surviving).toBe(false)
    expect(s.series).toHaveLength(1)
    expect(s.money.window.series).toEqual([
      { takenAt: '2026-09-14T12:00:00.000Z', returnUsd: 0, costUsd: 0 },
    ])
  })
})

describe('closed pages', () => {
  beforeEach(resetDb)
  afterEach(() => vi.unstubAllGlobals())

  it('pages closed trades ten at a time and clamps the page', async () => {
    stubFetch(liveRoutes())
    await seedFund()
    for (let i = 0; i < CLOSED_PAGE_SIZE + 1; i += 1) {
      await insertTrade({
        symbol: `S${i}`,
        status: 'closed',
        closedAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      })
    }
    const first = await buildSummary(db, alpaca, options, query('1M'))
    expect(first.closedTrades).toHaveLength(CLOSED_PAGE_SIZE)
    expect(first.closedTrades[0]?.symbol).toBe('S10')
    expect(first.closedPage).toEqual({ page: 1, pages: 2 })
    const second = await buildSummary(db, alpaca, options, query('1M', 2))
    expect(second.closedTrades.map((t) => t.symbol)).toEqual(['S0'])
    expect(second.closedPage).toEqual({ page: 2, pages: 2 })
    const clamped = await buildSummary(db, alpaca, options, query('1M', 9))
    expect(clamped.closedPage).toEqual({ page: 2, pages: 2 })
    const low = await buildSummary(db, alpaca, options, query('1M', 0))
    expect(low.closedPage).toEqual({ page: 1, pages: 2 })
  })
})

describe('researchSummary', () => {
  beforeEach(resetDb)

  it('keeps the five most recent analyses and observations per active fund', async () => {
    const social: Fund = {
      id: 'social',
      name: 'Social',
      mandate: 'm',
      share: 0.5,
      capital: 0,
      highWater: 0,
      rescues: 0,
      rescuedAt: null,
      status: 'active',
      createdAt: '2026-09-01T00:00:00.000Z',
      retiredAt: null,
      retireReason: null,
    }
    const rows = [0, 1, 2, 3, 4, 5]
    await db.insert(analyses).values(
      rows.map((i) => ({
        fund: 'social',
        kind: 'technical' as const,
        symbols: null,
        title: `e${i}`,
        body: 'b',
        figures: {},
        verdict: null,
        createdAt: `2026-09-0${i + 1}T00:00:00.000Z`,
      })),
    )
    await db.insert(observations).values(
      rows.map((i) => ({
        fund: 'social',
        source: 's',
        metric: 'm',
        note: `o${i}`,
        createdAt: `2026-09-0${i + 1}T00:00:00.000Z`,
      })),
    )
    const r = await researchSummary(db, [social, { ...social, id: 'retired', status: 'retired' }])
    expect(r.observationCount).toBe(6)
    expect(r.analysisCount).toBe(6)
    expect(r.noteCount).toBe(0)
    expect(r.byFund.map((m) => m.fund)).toEqual(['social'])
    expect(
      (await researchSummary(db, [{ id: 'social', status: 'active' }], 'other')).byFund,
    ).toEqual([])
    expect(
      (await researchSummary(db, [{ id: 'social', status: 'active' }], 'social')).byFund.map(
        (m) => m.fund,
      ),
    ).toEqual(['social'])
    expect(r.byFund[0]?.analyses.map((a) => a.title)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1'])
    expect(r.byFund[0]?.observations.map((o) => o.note)).toEqual(['o5', 'o4', 'o3', 'o2', 'o1'])
  })

  it('counts zero when the count queries yield nothing', async () => {
    expect(await researchSummary(stubDb([[], [], [], []]), [])).toEqual({
      noteCount: 0,
      observationCount: 0,
      analysisCount: 0,
      lessonCount: 0,
      byFund: [],
    })
  })
})

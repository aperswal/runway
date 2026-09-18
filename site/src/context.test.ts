import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  DATA,
  accountJson,
  clockJson,
  db,
  headlineJson,
  insertSnapshot,
  insertTrade,
  positionJson,
  resetDb,
  seedFund,
  stubFetch,
  testEnv,
  type Route,
} from '../test/helpers'
import { buildContext } from './context'
import { memoryText } from './context-sections'
import {
  analyses,
  jobs,
  lessons,
  monitors,
  notes as notesTable,
  notes,
  observations,
  runs,
} from './db/schema'
import { buildDeps } from './deps'

const now = new Date('2026-09-15T12:00:00Z')
const deps = buildDeps(testEnv())

const baseRoutes = (positions: Record<string, unknown>[] = [], marketOpen = true): Route[] => [
  { url: `${ALPACA}/v2/account`, body: accountJson({ daytradeCount: 1, patternDayTrader: false }) },
  { url: `${ALPACA}/v2/positions`, body: positions },
  { url: `${ALPACA}/v2/clock`, body: clockJson(marketOpen) },
]
const noNews: Route = { url: `${DATA}/v1beta1/news?limit=10`, body: { news: [] } }

describe('buildContext', () => {
  beforeEach(resetDb)
  afterEach(() => vi.unstubAllGlobals())

  it('describes progress in R and toward the target, degrading gracefully', async () => {
    stubFetch([
      ...baseRoutes(),
      noNews,
      { url: `${DATA}/v1beta1/news?limit=10&symbols=AAPL`, body: { news: [] } },
    ])
    await seedFund()
    await insertTrade({ symbol: 'AAPL', stop: 250, target: 190, trailPct: 4 })
    const text = await buildContext(deps, now)
    expect(text).toContain('(R n/a), stop $250.00 trailing 4%, target $190.00')
  })

  it('shows the operator directive while lots are being liquidated', async () => {
    stubFetch([
      ...baseRoutes(),
      noNews,
      { url: `${DATA}/v1beta1/news?limit=10&symbols=AAPL`, body: { news: [] } },
    ])
    await seedFund()
    await insertTrade({ symbol: 'AAPL', liquidate: true })
    const text = await buildContext(deps, now)
    expect(text).toContain('## Operator directive\nThe operator is liquidating the whole book.')
  })

  it('describes each fund book, its tier and its rescues', async () => {
    stubFetch([...baseRoutes(), noNews])
    await seedFund({ id: 'cut', name: 'Cut', capital: 85, highWater: 100, rescues: 1 })
    await seedFund({ id: 'shut', name: 'Shut', capital: 70, highWater: 100, rescues: 2 })
    const text = await buildContext(deps, now)
    expect(text).toContain(
      'cut (Cut, active): book $85.00 (high water $100.00, drawdown 15.00%, half allocation, 1 rescue), deployable $42.50',
    )
    expect(text).toContain(
      'shut (Shut, active): book $70.00 (high water $100.00, drawdown 30.00%, shut, no new positions, 2 rescues), deployable $0.00',
    )
  })

  it('marks research runs by their trigger', async () => {
    stubFetch([...baseRoutes(), noNews])
    const research = await buildContext(deps, new Date('2026-09-15T23:00:00.000Z'), {
      trigger: '0 0 * * *',
    })
    expect(research).toContain('This is a research run.')
    expect(research).toContain('Tonight: attack your book.')
    expect(research).toContain('next run at 2026-09-16T00:00:00.000Z (a research run)')
  })

  it('describes a fresh account with its schedule', async () => {
    const { calls } = stubFetch([
      ...baseRoutes(),
      { url: `${DATA}/v1beta1/news?limit=10`, body: { news: [headlineJson({ symbols: [] })] } },
    ])
    const text = await buildContext(deps, now)
    expect(text).toContain(
      'Time: 2026-09-15T12:00:00.000Z (UTC). US stock market OPEN; next open 2026-09-02T13:30:00Z, next close 2026-09-01T20:00:00Z.\nYour schedule: Trading runs on weekdays at 08:30 New York (an hour before the open), 09:50 (20 minutes after the open), 12:30 (lunch), 15:40 (20 minutes before the close) and 17:00 (an hour after the close). Research runs every night at 20:00, 22:00, 00:00, 02:00 and 04:00 New York. Cron times are UTC (trading 12:30, 13:50, 16:30, 19:40, 21:00; research 00:00, 02:00, 04:00, 06:00, 08:00) and do not shift with daylight saving. This is a trading run. Act on the research you already recorded: check your monitors and queued orders, then place the orders your notes and analyses give you a reason and a shaped payoff for; you place them yourself. This run ends when you finish your report; you are off until the next run at 2026-09-15T12:30:00.000Z (a trading run). Between runs the venue fills queued limit orders, enforces stops and targets every 15 minutes, and runs your scheduled jobs. Queue limit orders and set monitors for anything that must happen while you are off.',
    )
    expect(text).toContain(
      '## Money\nEquity $1000.00. Cash $800.00.\nRunway is funded by profit only: all-time return $0.00 minus all-time costs $0.00 = $0.00, which covers 0.00 months at $205.00/month.\nMonth started at $1000.00. Return so far $0.00. Shutdown threshold: return under $200.00 by month end. 16 days left. Still needed: $200.00.\nFull system costs so far this month: $102.50 (Claude subscription $100.00, Cloudflare $2.50, X posts $0.00). API-equivalent token spend $0.00. Net after costs $-102.50.\nPayout rule: at month end 20% of profit after costs is paid out to the operator. Paid out so far $0.00; capital after payouts $1000.00.\nStock day trades used',
    )
    expect(text).toContain(
      'Stock day trades used: 1 of 3 per 5 days (equity under $25000.00). Pattern day trader flag: false.',
    )
    expect(text).toContain('Max per position: 25% of equity = $250.00.')
    expect(text).toContain('Performance: 1D n/a | 1W n/a | 1M n/a | 3M n/a | ALL n/a')
    expect(text).toContain('## Funds\n\n## Open positions\nNone. All cash.')
    expect(text).toContain('## Queued orders (not filled yet; cancel_order to withdraw)\nNone.')
    expect(text).toContain('## Recent closed trades\nNone.')
    expect(text).toContain('## Your previous runs\nThis is your first run.')
    expect(text).toContain(
      '## Monitors (resolve_monitor with the outcome once you have acted)\n- none',
    )
    expect(text).toContain(
      '## Research memory (0 notes, 0 observations, 0 analyses, 0 lessons; each fund reads its own with query_research)',
    )
    expect(text).toContain('## Headlines (Alpaca news)\n- 2026-09-01T12:00 [market] Apple beats')
    expect(calls).toHaveLength(5)
  })

  it('includes funds, positions, queued orders, closed trades, runs, research and news', async () => {
    const { calls } = stubFetch([
      ...baseRoutes(
        [positionJson({ currentPrice: '220', marketValue: '110', unrealizedPl: '10' })],
        false,
      ),
      {
        url: `${DATA}/v1beta1/news?limit=10`,
        body: { news: [headlineJson({ headline: 'General' })] },
      },
      {
        url: `${DATA}/v1beta1/news?limit=10&symbols=AAPL%2CBTC`,
        body: { news: [headlineJson({ headline: 'Held', symbols: ['AAPL', 'BTC'] })] },
      },
    ])
    await seedFund()
    await insertSnapshot({ takenAt: '2026-09-01T12:00:00.000Z', equity: 1000, cash: 800 })
    await insertTrade({ symbol: 'AAPL' })
    await insertTrade({ symbol: 'BTC/USD', assetClass: 'crypto' })
    await insertTrade({
      symbol: 'MSFT',
      status: 'pending',
      qty: 2,
      notional: 380,
      limitPrice: 190,
      orderId: 'o9',
      openedAt: '2026-09-15T11:00:00.000Z',
      expiresAt: '2026-09-16T11:00:00.000Z',
    })
    await insertTrade({
      symbol: 'GLD',
      status: 'pending',
      qty: 0,
      notional: 20,
      openedAt: '2026-09-15T11:30:00.000Z',
    })
    await insertTrade({
      symbol: 'NVDA',
      status: 'closed',
      qty: 1,
      entryPrice: 100,
      exitPrice: 110,
      exitReason: 'target',
      closedAt: '2026-09-10T00:00:00.000Z',
    })
    await insertTrade({
      symbol: 'AMD',
      status: 'closed',
      qty: 1,
      entryPrice: 100,
      closedAt: null,
    })
    const run = {
      trigger: 'cron',
      model: 'm',
      inputTokens: 1,
      outputTokens: 1,
      turns: 1,
      costUsd: 1,
    }
    await db.insert(runs).values([
      {
        ...run,
        startedAt: '2026-09-02T00:00:00.000Z',
        finishedAt: '2026-09-02T00:05:00.000Z',
        summary: 'Bought AAPL',
      },
      {
        ...run,
        startedAt: '2026-09-03T00:00:00.000Z',
        finishedAt: '2026-09-03T00:05:00.000Z',
        summary: '',
        error: 'timeout',
      },
    ])
    await db.insert(analyses).values([
      {
        fund: 'social',
        kind: 'backtest',
        symbols: 'AAPL,MSFT',
        title: 'e1',
        body: 'weak',
        figures: { return: 1 },
        verdict: 'reject',
        createdAt: '2026-09-05T00:00:00.000Z',
      },
      {
        fund: 'social',
        kind: 'consequences',
        symbols: null,
        title: 'e2',
        body: 'chain',
        figures: {},
        verdict: null,
        createdAt: '2026-09-04T00:00:00.000Z',
      },
    ])
    await db.insert(notesTable).values({
      fund: 'social',
      title: 'Thesis',
      body: 'Watch AAPL',
      createdAt: '2026-09-07T00:00:00.000Z',
    })
    await db.insert(observations).values([
      {
        fund: 'social',
        symbol: 'AAPL',
        source: 'site',
        metric: 'reviews',
        value: 12,
        note: 'up',
        createdAt: '2026-09-05T00:00:00.000Z',
      },
      {
        fund: 'social',
        source: 'site',
        metric: 'mood',
        note: 'meh',
        createdAt: '2026-09-06T00:00:00.000Z',
      },
    ])

    const text = await buildContext(deps, now)
    expect(text).toContain('US stock market CLOSED;')
    expect(text).toContain('Performance: 1D 0.00% | 1W 0.00% | 1M 0.00% | 3M 0.00% | ALL 0.00%')
    expect(text).toContain('Month started at $1000.00. Return so far $0.00.')
    expect(text).toContain(
      '## Funds\nsocial (Social signal, active): book $500.00 (high water $500.00, drawdown 0.00%, full allocation), deployable $500.00, deployed $600.00, unrealized $10.00, realized $10.00, 2 open, 2 closed, win rate 50.00%, avg return 5.00%. Mandate: Find products',
    )
    expect(text).toContain(
      'AAPL [social]: qty 0.5, value $110.00, entry $200.00, now $220.00, unrealized $10.00 (1.0R, 50% of the way to target), stop $180.00, target $240.00, horizon 2 weeks, opened 2026-08-20T14:00:00.000Z. Reason: Review velocity is accelerating',
    )
    expect(text).toContain(
      'BTC/USD [social]: qty 0.5, value $100.00, entry $200.00, now $200.00, unrealized $0.00',
    )
    expect(text).toContain(
      '## Queued orders (not filled yet; cancel_order to withdraw)\nMSFT [social]: limit $190.00 x 2, about $380.00, stop $180.00, target $240.00, queued 2026-09-15T11:00:00.000Z, alive until 2026-09-16T11:00:00.000Z. Reason: Review velocity is accelerating\nGLD [social]: market, about $20.00, stop $180.00',
    )
    expect(text).toContain(
      'NVDA [social]: entry $100.00, exit $110.00, closed 2026-09-10T00:00:00.000Z, reason target\nAMD [social]: entry $100.00, exit $100.00, closed , reason \n\n## Closed trades awaiting a lesson (record_lesson with the trade id: technical, execution, psyche)\n- trade #',
    )
    expect(text).toContain(
      '2026-09-03T00:05:00.000Z (cron): ERROR timeout\n2026-09-02T00:05:00.000Z (cron): Bought AAPL',
    )
    expect(text).toContain(
      '## Research memory (1 notes, 2 observations, 2 analyses, 0 lessons; each fund reads its own with query_research)\n### social\nLessons (rules you set for yourself; say which one applies today):\n- none yet\nNotes:\n- 2026-09-07T00:00 Thesis: Watch AAPL\nObservations:\n- 2026-09-06T00:00 mood: meh (site)\n- 2026-09-05T00:00 AAPL reviews = 12: up (site)\nAnalyses:\n- 2026-09-05T00:00 [backtest, reject] e1 (AAPL, MSFT): weak\n- 2026-09-04T00:00 [consequences] e2: chain',
    )
    expect(text).toContain('- 2026-09-01T12:00 [AAPL,BTC] Held\n- 2026-09-01T12:00 [AAPL] General')
    expect(calls).toHaveLength(6)
  })

  it('lists active jobs and open monitors, flagging due ones', async () => {
    stubFetch([...baseRoutes(), noNews])
    await seedFund()
    await db.insert(jobs).values([
      {
        fund: 'social',
        name: 'funding',
        script: 'x',
        everyMinutes: 60,
        remainingRuns: 3,
        timeoutSeconds: 300,
        status: 'active',
        nextRunAt: '2026-09-15T13:00:00.000Z',
        lastExitCode: 0,
        createdAt: '2026-09-15T12:00:00.000Z',
      },
      {
        fund: 'social',
        name: 'fresh',
        script: 'x',
        everyMinutes: 15,
        remainingRuns: 1,
        timeoutSeconds: 300,
        status: 'active',
        nextRunAt: '2026-09-15T12:15:00.000Z',
        createdAt: '2026-09-15T12:00:00.000Z',
      },
      {
        fund: 'social',
        name: 'old',
        script: 'x',
        everyMinutes: 15,
        remainingRuns: 0,
        timeoutSeconds: 300,
        status: 'done',
        nextRunAt: '2026-09-15T12:15:00.000Z',
        createdAt: '2026-09-15T12:00:00.000Z',
      },
    ])
    const monitor = {
      fund: 'social',
      watch: 'guide',
      createdAt: '2026-09-15T12:00:00.000Z',
    }
    await db.insert(monitors).values([
      {
        ...monitor,
        symbol: 'A',
        event: 'earnings',
        eventAt: '2026-09-20T20:00:00.000Z',
        status: 'armed',
      },
      {
        ...monitor,
        symbol: 'B',
        event: 'fda',
        eventAt: '2026-09-15T11:00:00.000Z',
        status: 'armed',
      },
      {
        ...monitor,
        symbol: 'C',
        event: 'launch',
        eventAt: '2026-09-14T00:00:00.000Z',
        status: 'due',
      },
      {
        ...monitor,
        symbol: 'D',
        event: 'gone',
        eventAt: '2026-09-13T00:00:00.000Z',
        status: 'done',
      },
      {
        ...monitor,
        symbol: 'E',
        event: 'flagged',
        eventAt: '2026-09-30T00:00:00.000Z',
        status: 'due',
      },
      {
        ...monitor,
        symbol: 'F',
        event: 'now',
        eventAt: '2026-09-15T12:00:00.000Z',
        status: 'armed',
      },
    ])
    const text = await buildContext(deps, now)
    expect(text).toContain(
      '## Scheduled jobs (their output lands in your notes)\n- #1 [social] funding: every 60 min, 3 runs left, next 2026-09-15T13:00, last exit 0\n- #2 [social] fresh: every 15 min, 1 runs left, next 2026-09-15T12:15\n\n',
    )
    expect(text).not.toContain('] old:')
    expect(text).toContain(
      '## Monitors (resolve_monitor with the outcome once you have acted)\n- #3 [social] C launch at 2026-09-14T00:00 (DUE NOW): guide\n- #2 [social] B fda at 2026-09-15T11:00 (DUE NOW): guide\n- #6 [social] F now at 2026-09-15T12:00 (DUE NOW): guide\n- #1 [social] A earnings at 2026-09-20T20:00 (armed): guide\n- #5 [social] E flagged at 2026-09-30T00:00 (DUE NOW): guide\n\n',
    )
    expect(text).not.toContain('D gone')
  })
  it('shows empty memory sections for an active fund', async () => {
    stubFetch([...baseRoutes(), noNews])
    await seedFund()
    await db.insert(lessons).values([
      {
        fund: 'social',
        kind: 'psyche',
        lesson: 'Do not chase.',
        tradeId: null,
        createdAt: '2026-09-08T00:00:00.000Z',
      },
      {
        fund: 'social',
        kind: 'technical',
        lesson: 'RSI alone is not a signal.',
        tradeId: 5,
        createdAt: '2026-09-07T00:00:00.000Z',
      },
    ])
    const text = await buildContext(deps, now)
    expect(text).toContain(
      '## Scheduled jobs (their output lands in your notes)\n- none\n\n## Headlines',
    )
    expect(text).toContain('0 open, 0 closed, win rate n/a, avg return n/a.')
    expect(text).toContain(
      '## Research memory (0 notes, 0 observations, 0 analyses, 2 lessons; each fund reads its own with query_research)\n### social\nLessons (rules you set for yourself; say which one applies today):\n- 2026-09-08T00:00 [psyche] Do not chase.\n- 2026-09-07T00:00 [technical, trade #5] RSI alone is not a signal.\nNotes:\n- none yet\nObservations:\n- none yet\nAnalyses:\n- none yet',
    )
  })

  it('needs nothing more once the month return covers the subscription', async () => {
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson({ equity: '1300' }) },
      { url: `${ALPACA}/v2/positions`, body: [] },
      { url: `${ALPACA}/v2/clock`, body: clockJson(true) },
      noNews,
    ])
    await insertSnapshot({ takenAt: '2026-09-01T12:00:00.000Z', equity: 1000 })
    await insertSnapshot({ takenAt: '2026-09-15T11:00:00.000Z', equity: 1290 })
    const text = await buildContext(deps, now)
    expect(text).toContain(
      'Month started at $1000.00. Return so far $300.00. Shutdown threshold: return under $200.00 by month end. 16 days left. Still needed: $0.00.',
    )
    expect(text).toContain('all-time return $300.00 minus all-time costs $94.')
  })
})

describe('memoryText', () => {
  it('caps long entries and drops data blobs', () => {
    expect(memoryText('short')).toBe('short')
    const long = 'word '.repeat(200)
    expect(memoryText(long)).toBe(`${long.slice(0, 700)} ...`)
    expect(memoryText(`archive PAYLOAD:\n${'a'.repeat(50)}`)).toBeNull()
    expect(memoryText('A'.repeat(200))).toBeNull()
  })
})

describe('memory in context', () => {
  it('skips data blobs and caps long entries', async () => {
    await resetDb()
    await seedFund()
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson() },
      { url: `${ALPACA}/v2/positions`, body: [] },
      { url: `${ALPACA}/v2/clock`, body: clockJson() },
      { url: `${DATA}/v1beta1/news?limit=10`, body: { news: [] } },
    ])
    const at = '2026-09-05T00:00:00.000Z'
    await db.insert(notes).values([
      { fund: 'social', title: 'archive 1/4', body: `PAYLOAD:\n${'a'.repeat(80)}`, createdAt: at },
      { fund: 'social', title: 'plan', body: 'word '.repeat(200), createdAt: at },
    ])
    await db.insert(observations).values([
      { fund: 'social', source: 's', metric: 'blob', note: 'b'.repeat(200), createdAt: at },
      { fund: 'social', source: 's', metric: 'long', note: 'tick '.repeat(200), createdAt: at },
    ])
    await db.insert(analyses).values([
      {
        fund: 'social',
        kind: 'backtest',
        title: 'blob study',
        body: 'c'.repeat(200),
        figures: {},
        createdAt: at,
      },
      {
        fund: 'social',
        kind: 'backtest',
        title: 'long study',
        body: 'row '.repeat(300),
        figures: {},
        createdAt: at,
      },
    ])
    const text = await buildContext(deps, now, { fund: 'social' })
    expect(text).not.toContain('archive 1/4')
    expect(text).not.toContain('blob:')
    expect(text).not.toContain('blob study')
    expect(text).toContain(`plan: ${'word '.repeat(140)} ...`)
    expect(text).toContain(`long: ${'tick '.repeat(140)} ...`)
    expect(text).toContain(`long study: ${'row '.repeat(175)} ...`)
    expect(await buildContext(deps, now, { fund: 'other' })).not.toContain('### social')
  })
})

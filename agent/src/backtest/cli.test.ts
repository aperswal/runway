import { afterEach, describe, expect, it, vi } from 'vitest'
import { USAGE, parseFlags, runBacktest } from './cli.ts'

afterEach(() => vi.unstubAllGlobals())

const source = { siteUrl: 'https://runway.test', dataToken: 'data-tok' }
const now = new Date('2024-03-01T12:00:00Z')
const bar = (t: string, c: number, h = c, l = c) => ({ t, o: c, h, l, c, v: 0 })

function stubBars(bars: Record<string, unknown>) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ bars, next_page_token: null })))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('parseFlags', () => {
  it('pairs flags with values and marks bare flags true', () =>
    expect(parseFlags(['--symbols', 'AAPL', '--dry', '--days', '30', '--verbose'])).toEqual({
      symbols: 'AAPL',
      dry: 'true',
      days: '30',
      verbose: 'true',
    }))
  it('ignores positionals', () => expect(parseFlags(['run', 'now'])).toEqual({}))
})

describe('USAGE', () => {
  it('documents every strategy and flag', () =>
    expect(USAGE).toBe(
      'usage: backtest --symbols AAPL,MSFT --strategy <sma-cross|breakout|rsi|momentum|mean-reversion|pairs|xs-momentum> [--days 365] [--fast 10 --slow 50 | --lookback 20 | --period 14 --low 30 --high 70 | --entry 2 --exit 0.5 | --top 3 --rebalance 20] [--stop-pct 5] [--target-pct 10]; pairs needs exactly two symbols',
    ))
})

describe('runBacktest', () => {
  it('prints usage for an unknown strategy', async () =>
    expect(await runBacktest({ symbols: 'AAPL', strategy: 'magic' }, source, now)).toBe(USAGE))
  it('prints usage without symbols', async () =>
    expect(await runBacktest({ strategy: 'momentum', symbols: ' , ' }, source, now)).toBe(USAGE))
  it('prints usage when the symbols flag is missing', async () =>
    expect(await runBacktest({ strategy: 'momentum' }, source, now)).toBe(USAGE))
  it('prints usage when neither flag is given', async () =>
    expect(await runBacktest({}, source, now)).toBe(USAGE))
  it('applies numeric params, days and exits to every symbol', async () => {
    const fetchMock = stubBars({ AAPL: [bar('d0', 1), bar('d1', 2), bar('d2', 1.9, 2, 1.8)] })
    const flags = {
      symbols: 'aapl, msft',
      strategy: 'momentum',
      lookback: '1',
      days: '5',
      'stop-pct': '5',
      'target-pct': '50',
    }
    const reports = await runBacktest(flags, source, now)
    expect(fetchMock.mock.calls[0]![0]).toContain('symbols=AAPL%2CMSFT')
    expect(fetchMock.mock.calls[0]![0]).toContain('start=2024-02-25')
    expect(reports).toMatchObject([
      {
        symbol: 'AAPL',
        bars: 3,
        trades: [{ entryAt: 'd1', exitAt: 'd2', entry: 2, exit: 1.9, reason: 'stop' }],
      },
      { symbol: 'MSFT', bars: 0, trades: [] },
    ])
  })
  it('takes profit at the target percentage', async () => {
    stubBars({ AAPL: [bar('d0', 1), bar('d1', 2), bar('d2', 2.5, 2.6, 2.4)] })
    const flags = { symbols: 'AAPL', strategy: 'momentum', lookback: '1', 'target-pct': '25' }
    await expect(runBacktest(flags, source, now)).resolves.toMatchObject([
      { trades: [{ entryAt: 'd1', exitAt: 'd2', entry: 2, exit: 2.5, reason: 'target' }] },
    ])
  })
  it('prints usage for pairs with one symbol', async () =>
    expect(await runBacktest({ symbols: 'AAPL', strategy: 'pairs' }, source, now)).toBe(USAGE))
  it('prints usage for pairs with three symbols', async () =>
    expect(await runBacktest({ symbols: 'A,B,C', strategy: 'pairs' }, source, now)).toBe(USAGE))
  it('runs pairs on two symbols with the spread params', async () => {
    const fetchMock = stubBars({
      AAPL: [bar('d0', 24), bar('d1', 16), bar('d2', 12), bar('d3', 12)],
      MSFT: [bar('d0', 2), bar('d1', 2), bar('d2', 2), bar('d3', 2)],
    })
    const flags = { symbols: 'aapl,msft', strategy: 'pairs', lookback: '2', entry: '1', exit: '0' }
    const reports = await runBacktest(flags, source, now)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(reports).toMatchObject([
      {
        symbol: 'AAPL/MSFT',
        bars: 4,
        trades: [{ entryAt: 'd1', exitAt: 'd3', entry: 8, exit: 6, reason: 'signal' }],
        returnPct: -25,
      },
    ])
  })
  it('runs pairs with a leg missing from the response', async () => {
    stubBars({ AAPL: [bar('d0', 1)] })
    await expect(
      runBacktest({ symbols: 'AAPL,MSFT', strategy: 'pairs' }, source, now),
    ).resolves.toMatchObject([{ symbol: 'AAPL/MSFT', bars: 0, trades: [] }])
  })
  it('runs xs-momentum on a single symbol with the ranking params', async () => {
    stubBars({ AAPL: [bar('d0', 10), bar('d1', 20), bar('d2', 15)] })
    const flags = {
      symbols: 'AAPL,MSFT',
      strategy: 'xs-momentum',
      lookback: '1',
      top: '1',
      rebalance: '1',
    }
    await expect(runBacktest(flags, source, now)).resolves.toMatchObject([
      { symbol: 'universe', bars: 0, trades: [], returnPct: 0 },
    ])
    stubBars({ AAPL: [bar('d0', 10), bar('d1', 20), bar('d2', 15)] })
    await expect(runBacktest({ ...flags, symbols: 'AAPL' }, source, now)).resolves.toMatchObject([
      {
        symbol: 'universe',
        bars: 3,
        trades: [{ entryAt: 'd1', exitAt: 'd2', entry: 20, exit: 15, reason: 'rebalance' }],
        returnPct: -25,
      },
    ])
  })
  it('uses defaults without params or exits', async () => {
    const fetchMock = stubBars({ AAPL: [bar('d0', 1), bar('d1', 2)] })
    const reports = await runBacktest({ symbols: 'AAPL', strategy: 'momentum' }, source, now)
    expect(fetchMock.mock.calls[0]![0]).toContain('start=2023-03-02')
    expect(reports).toMatchObject([{ symbol: 'AAPL', bars: 2, trades: [], returnPct: 0 }])
  })
})

import { describe, expect, it } from 'vitest'
import type { Analysis, Monitor } from './db/schema'
import type { StatsData } from './stats'
import { KINDS, href, kindLabel, renderStats } from './stats-page'

const analysis = (over: Partial<Analysis>): Analysis => ({
  id: 1,
  fund: 'quant',
  kind: 'backtest',
  symbols: 'AAPL,MSFT',
  title: 'SMA <10/50>',
  body: 'line one\nline two',
  figures: { return: 12.345, drawdown: 8, sample: 240, note: 'oos <ok>' },
  verdict: 'adopt',
  createdAt: '2026-09-05T14:32:00.000Z',
  ...over,
})
const monitor = (over: Partial<Monitor>): Monitor => ({
  id: 1,
  fund: 'quant',
  symbol: 'NVDA',
  event: 'earnings',
  eventAt: '2026-11-19T21:00:00.000Z',
  watch: 'guide > $60B <hold>',
  status: 'armed',
  outcome: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  doneAt: null,
  ...over,
})

const data: StatsData & { url: string } = {
  url: 'https://runway.test/stats',
  query: { page: 1, view: 'plain', section: 'analyses' },
  fundNames: { quant: 'Quant replication' },
  kinds: KINDS.map((key) => ({ key, n: key === 'backtest' ? 3 : 0 })),
  monitors: [monitor({}), monitor({ id: 2, symbol: 'RARE', event: 'PDUFA', status: 'due' })],
  strategies: [
    {
      id: 1,
      title: 'SMA <10/50>',
      fund: 'quant',
      symbols: ['AAPL', 'MSFT'],
      returnPct: 12.3,
      drawdownPct: 8.12,
      verdict: 'adopt',
    },
    {
      id: 2,
      title: 'Pairs',
      fund: 'quant',
      symbols: [],
      returnPct: -3,
      drawdownPct: null,
      verdict: null,
    },
  ],
  entries: [
    analysis({}),
    analysis({
      id: 2,
      kind: 'consequences',
      symbols: null,
      verdict: 'watch',
      figures: {},
      fund: 'ghost',
    }),
    analysis({ id: 5, verdict: null }),
    analysis({ id: 3, verdict: 'reject' }),
    analysis({ id: 4, verdict: 'inconclusive' }),
  ],
  total: 4,
  pages: 1,
}

describe('href', () => {
  it('keeps filters, the section and the view, and drops page one', () => {
    const q = { page: 1, view: 'plain' as const, section: 'analyses' as const }
    expect(href(q, {})).toBe('/stats')
    expect(href({ ...q, kind: 'backtest', fund: 'q', symbol: 'A' }, { page: 3 })).toBe(
      '/stats?kind=backtest&fund=q&symbol=A&page=3',
    )
    expect(href({ ...q, page: 2, kind: 'backtest' }, { kind: undefined })).toBe('/stats')
    expect(href({ ...q, section: 'watching' }, { view: 'agent' })).toBe(
      '/stats?section=watching&view=agent',
    )
    expect(kindLabel('simulation')).toBe('Simulations')
    expect(KINDS).toHaveLength(8)
  })
})

describe('renderStats', () => {
  it('renders the sticky bar, the kind pills and the escaped feed with tiles', () => {
    const html = renderStats(data)
    expect(html).toContain('<title>Runway stats</title>')
    expect(html).toContain('<a href="/stats" class="active">Stats</a>')
    expect(html).toContain('<h1>Stats</h1><div class="sub">4 analyses, newest first</div>')
    expect(html).toContain(
      '<nav class="seg"><a href="/stats" class="active">Analyses</a><a href="/stats?section=watching" class="">Watching<span class="num">2</span></a><a href="/stats?section=strategies" class="">Best strategies</a></nav>',
    )
    expect(html).toContain(
      '<div class="side"><nav class="seg"><a href="/stats" class="active">Plain words</a><a href="/stats?view=agent" class="">Agent</a></nav></div></div>',
    )
    expect(html).toContain(
      '<nav class="pillrow"><a href="/stats" class="active">All funds</a><a href="/stats?fund=quant" class="">Quant replication</a></nav></div>',
    )
    expect(html).toContain(
      '<nav class="pillrow"><a href="/stats" class="active">All<span class="num">3</span></a><a href="/stats?kind=statistical" class="">Statistical<span class="num">0</span></a>',
    )
    expect(html).toContain(
      '<a href="/stats?kind=backtest" class="">Backtests<span class="num">3</span></a>',
    )
    expect(html).toContain(
      '<div class="entry"><div class="title">SMA &lt;10/50&gt;</div><div class="meta"><span class="tag">Backtests</span><span class="dot up">adopt</span><span>Quant replication</span><span>AAPL, MSFT</span><span class="num">2026-09-05 14:32</span></div><div class="body">line one\nline two</div><div class="tiles"><div class="tile"><span>return</span><b class="num">12.35</b></div><div class="tile"><span>drawdown</span><b class="num">8</b></div><div class="tile"><span>sample</span><b class="num">240</b></div><div class="tile"><span>note</span><b class="num">oos &lt;ok&gt;</b></div></div></div>',
    )
    expect(html).toContain(
      '<span class="tag">Consequences</span><span class="dot muted">watch</span><span>ghost</span><span class="num">',
    )
    expect(html).toContain('<span class="dot down">reject</span>')
    expect(html).toContain('<span class="dot muted">inconclusive</span>')
    expect(html).toContain('<span class="tag">Backtests</span><span>Quant replication</span>')
    expect(html).not.toContain('class="pager')
  })
  it('renders the watching and strategies sections without kind pills', () => {
    const watching = renderStats({ ...data, query: { ...data.query, section: 'watching' } })
    expect(watching).toContain('<h1>Stats</h1><div class="sub">2 events</div>')
    expect(watching).toContain('<a href="/stats?section=watching" class="active">Watching')
    expect(watching).not.toContain('<a href="/stats?section=watching&kind=backtest"')
    expect(watching).toContain(
      '<b>NVDA</b> earnings<div class="sub">guide &gt; $60B &lt;hold&gt;</div>',
    )
    expect(watching).toContain('<b>RARE</b> PDUFA <span class="chip">due</span>')
    expect(watching).toContain('<div class="n num muted">2026-11-19</div>')
    const strategies = renderStats({ ...data, query: { ...data.query, section: 'strategies' } })
    expect(strategies).toContain('<div class="sub">ranked by return</div>')
    expect(strategies).toContain(
      '<div class="rank"><div>SMA &lt;10/50&gt;<div class="sub">AAPL, MSFT &middot; drawdown 8.12%</div></div><div class="n num up">+12.30%</div><div class="bar"><div style="width:100%"></div></div></div>',
    )
    expect(strategies).toContain(
      '<div class="rank"><div>Pairs<div class="sub"></div></div><div class="n num down">-3.00%</div><div class="bar"><div style="width:0%"></div></div></div>',
    )
    expect(
      renderStats({ ...data, query: { ...data.query, section: 'watching' }, monitors: [] }),
    ).toContain('No events being watched.')
    expect(
      renderStats({ ...data, query: { ...data.query, section: 'strategies' }, strategies: [] }),
    ).toContain('No backtests with a return yet.')
  })
  it('marks the active kind and fund, pages the feed and says when empty', () => {
    const html = renderStats({
      ...data,
      query: { page: 2, view: 'plain', section: 'analyses', kind: 'technical', fund: 'quant' },
      entries: [],
      pages: 3,
    })
    expect(html).toContain('<div class="sub">4 technical, newest first</div>')
    expect(html).toContain(
      '<a href="/stats?kind=technical&fund=quant" class="active">Technical<span class="num">0</span></a>',
    )
    expect(html).toContain('<a href="/stats?fund=quant" class="">All<span class="num">3</span></a>')
    expect(html).toContain(
      '<a href="/stats?kind=technical&fund=quant" class="active">Quant replication</a>',
    )
    expect(html).toContain('<p class="muted">Nothing here yet.</p>')
    expect(html).toContain(
      '<div class="pager num"><a href="/stats?kind=technical&fund=quant">Newer</a><span class="muted">Page 2 of 3</span><a href="/stats?kind=technical&fund=quant&page=3">Older</a></div>',
    )
    const clamped = renderStats({
      ...data,
      entries: [analysis({ id: 9, body: 'row '.repeat(120) })],
    })
    expect(clamped).toContain(
      '<input type="checkbox" class="more" id="a9"><div class="body clamp">row row',
    )
    expect(clamped).toContain('<label for="a9">More</label>')
  })
})

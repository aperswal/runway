import { describe, expect, it } from 'vitest'
import { emptyMetrics, makeSummary } from '../test/summary-fixture'
import { fundRows, lastRunNote, relative, signedUsd, survivalCard } from './page-sections'
import { PAGE_PATH, renderPage } from './page'

const render = (s: Parameters<typeof renderPage>[0]): string =>
  renderPage(s, 'https://runway.test/?h=1M')
import { pageScript } from './page-script'

describe('renderPage', () => {
  it('renders the number, the chart, the pills and every section, escaping agent text', () => {
    const html = render(makeSummary())
    expect(html).toContain(
      '<div class="equity num" id="equity" data-cash="700" data-equity="1100" data-h="1M" data-baselines=\'{"1D":1089.11,"1W":1122.45,"1M":1000,"3M":null,"ALL":901.64}\'>$1,100.00</div>',
    )
    expect(pageScript()).toContain('new WebSocket(')
    expect(pageScript()).toContain("addEventListener('pointerdown'")
    expect(html).toContain(
      '<div class="change num up" id="change">+$100.00 (+10.00%) <span class="muted" style="font-weight:400">past month</span></div>',
    )
    expect(html).toContain('<svg class="chart muted" data-h="1D" hidden ')
    expect(html).toContain('<svg class="chart up" data-h="1W" hidden data-points=')
    expect(html).toContain('<svg class="chart up" data-h="1M" data-points=')
    expect(html).toContain('<svg class="chart muted" data-h="3M" hidden ')
    expect(html).toContain('</svg><svg class="chart up" data-h="1W"')
    expect(html).toContain('<svg class="chart up" data-h="ALL" hidden data-points=')
    expect(html).toContain(
      '<nav class="pills"><a href="/?h=1D" data-h="1D" class="">1D</a><a href="/?h=1W" data-h="1W" class="">1W</a><a href="/?h=1M" data-h="1M" class="active">1M</a><a href="/?h=3M" data-h="3M" class="">3M</a><a href="/?h=ALL" data-h="ALL" class="">All</a></nav>',
    )
    expect(html).toContain(`<script>${pageScript()}</script>`)
    expect(pageScript()).toContain("document.getElementById('equity')")
    expect(pageScript()).toContain("addEventListener('pointermove'")
    expect(pageScript()).toContain("addEventListener('pointercancel'")
    expect(pageScript()).toContain('LONG_PRESS=350')
    expect(html).toContain('touch-action:pan-y')
    expect(html).toContain('.chart[hidden]{display:none}')
    expect(html).toContain(
      '<div class="plot"><div class="tip num" id="tip" hidden><b></b><span></span></div><svg class="chart',
    )
    expect(pageScript()).toContain("document.getElementById('tip')")
    expect(html).toContain('.equity{font-size:44px;font-weight:600')
    expect(html).toContain('.detail{grid-column:1/-1')
    expect(PAGE_PATH).toBe('/')
    expect(html).toContain('<div class="k">Runway from profit</div><div class="v num">0.5 mo</div>')
    expect(html).toContain('<div class="v num">$102.53</div>')
    expect(html).toContain('<div class="v num">$10.00</div>')
    expect(html).toContain(
      'Claude $100.00, Cloudflare $2.50, X posts $0.03. Tokens at API rates would be $3.00.',
    )
    expect(html).toContain('<p class="note">Bought &lt;AAPL&gt;</p>')
    expect(html).toContain('fonts.googleapis.com/css2?family=Schibsted+Grotesk')
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('<title>Runway</title>')
    expect(html).toContain('<a href="/" class="active">Portfolio</a>')
    expect(html).not.toContain('<h2>Queued</h2>')
    expect(html).toContain('<section><h2>Holdings</h2>')
    expect(html).not.toContain('Paper')
    expect(html).not.toContain('Not financial advice')
  })
  it('shows the queue between holdings and closed when orders are waiting', () => {
    const html = render(
      makeSummary({
        queued: [
          {
            fund: 'social',
            symbol: 'MSFT',
            qty: 2,
            notional: 25,
            limitPrice: 12.5,
            expiresAt: null,
            stop: 10,
            target: 15,
            horizon: '1 week',
            reason: 'r',
            openedAt: '2026-09-15T11:00:00.000Z',
          },
        ],
      }),
    )
    expect(html).toContain('</section>\n<section><h2>Queued</h2>')
    expect(html).toContain('</section>\n<section><h2>Closed</h2>')
  })
  it('colors a losing month red and renders placeholders for an empty account', () => {
    const s = makeSummary()
    const html = render({
      ...s,
      equity: 0,
      cash: 0,
      holdings: [],
      closedTrades: [],
      lastRun: null,
      series: [],
      charts: { '1D': [], '1W': [], '1M': [], '3M': [], ALL: [] },
      horizons: [{ label: '1M', pct: -100, baseline: 5 }],
    })
    expect(html).toContain('<div class="change num down" id="change">-$5.00 (-100.00%)')
    expect(render({ ...s, horizons: [{ label: '1M', pct: 0, baseline: 1100 }] })).toContain(
      '<div class="change num up" id="change">+$0.00 (+0.00%)',
    )
    expect(render({ ...s, horizon: '3M' })).toContain(
      '<div class="change num up" id="change"></div>',
    )
    expect(render({ ...s, horizons: [] })).toContain(
      '<div class="change num up" id="change"></div>',
    )
    expect(html).toContain('All cash. $0.00')
    expect(html).toContain('Nothing closed yet.')
    expect(html).toContain('No runs yet.')
    expect(html).toContain('aria-label="Equity over time, no data yet"')
    expect(render({ ...s, horizons: [{ label: '1M', pct: null, baseline: 1100 }] })).toContain(
      '<div class="change num up" id="change">+$0.00 <span class="muted"',
    )
  })
})

describe('fundRows', () => {
  it('lists active funds with realized plus unrealized, and Cash when idle', () => {
    const s = makeSummary()
    const html = fundRows({
      ...s,
      funds: [
        s.funds[0]!,
        {
          ...s.funds[0]!,
          id: 'idle',
          name: 'Idle',
          openCount: 0,
          metrics: emptyMetrics,
          unrealizedPl: 0,
        },
        { ...s.funds[0]!, id: 'loss', name: 'Loss', unrealizedPl: -30 },
        { ...s.funds[0]!, id: 'flat', name: 'Flat', openCount: 0, unrealizedPl: 0 },
        {
          ...s.funds[0]!,
          id: 'fresh',
          name: 'Fresh',
          openCount: 1,
          metrics: emptyMetrics,
          unrealizedPl: 2,
        },
        s.funds[1]!,
      ],
    })
    expect(html).toContain(
      'Social &amp; signal</div><div class="sub num">$550.00 book</div></div><div class="delta num up">+$19.00</div></div><div class="row">',
    )
    const after = (name: string): string => html.slice(html.indexOf(`${name}</div>`))
    expect(after('Flat')).toContain('<div class="delta num up">+$10.00</div>')
    expect(after('Fresh')).toContain('<div class="delta num up">+$2.00</div>')
    expect(after('Idle')).toContain('<div class="delta num muted">Cash</div>')
    expect(after('Loss')).toContain('<div class="delta num down">-$20.00</div>')
    expect(html).not.toContain('Old')
  })
})

describe('survivalCard', () => {
  it('shows progress toward the subscription and the days left', () => {
    const html = survivalCard(makeSummary())
    expect(html).toContain('<div class="sub num">16 days left</div>')
    expect(html).toContain('<div class="bar"><div style="width:50%"></div></div>')
    expect(html).toContain('<div class="sub num">$100.00 of $200.00 needed this month</div>')
  })
  it('clamps the bar, uses the singular day, and celebrates once covered', () => {
    const s = makeSummary()
    const under = survivalCard({
      ...s,
      money: { ...s.money, month: { ...s.money.month, returnUsd: -40, daysLeft: 1 } },
    })
    expect(under).toContain('width:0%')
    expect(under).toContain('1 day left')
    expect(under).toContain('$0.00 of $200.00 needed this month')
    const over = survivalCard({
      ...s,
      money: { ...s.money, month: { ...s.money.month, returnUsd: 260, surviving: true } },
    })
    expect(over).toContain('width:100%')
    expect(over).toContain('Covered this month. +$260.00 against $200.00.')
  })
})

describe('lastRunNote', () => {
  it('shows a short note whole with its age', () => {
    const html = lastRunNote(makeSummary())
    expect(html).toContain('<div class="sub num">1d ago</div>')
    expect(html).toBe(
      '<div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">Last run</h2><div class="sub num">1d ago</div></div><p class="note">Bought &lt;AAPL&gt;</p>',
    )
    const exact = 'x'.repeat(180)
    const whole = lastRunNote(
      makeSummary({
        lastRun: { finishedAt: '2026-09-14T00:05:00.000Z', summary: exact, costUsd: 1 },
      }),
    )
    expect(whole).toContain(`<p class="note">${exact}</p>`)
    expect(whole).not.toContain('<details>')
  })
  it('previews a long note and folds the rest behind a summary', () => {
    const text = `${'a'.repeat(179)} ${'b'.repeat(40)}`
    const html = lastRunNote(
      makeSummary({
        lastRun: { finishedAt: '2026-09-15T11:30:00.000Z', summary: ` ${text} `, costUsd: 1 },
      }),
    )
    expect(html).toContain('just now')
    expect(html).toContain(`<p class="note">${'a'.repeat(179)}...</p>`)
    expect(html).toContain(
      `<details><summary>Read the full note</summary><p class="note">${text}</p></details>`,
    )
  })
  it('says when there are no runs', () => {
    expect(lastRunNote(makeSummary({ lastRun: null }))).toBe(
      '<h2>Last run</h2><p class="muted">No runs yet.</p>',
    )
  })
})

describe('relative and signedUsd', () => {
  it('rounds down to hours and days', () => {
    expect(relative('2026-09-15T11:00:01.000Z', '2026-09-15T12:00:00.000Z')).toBe('just now')
    expect(relative('2026-09-15T11:00:00.000Z', '2026-09-15T12:00:00.000Z')).toBe('1h ago')
    expect(relative('2026-09-15T01:30:00.000Z', '2026-09-15T12:00:00.000Z')).toBe('10h ago')
    expect(relative('2026-09-14T12:00:00.000Z', '2026-09-15T12:00:00.000Z')).toBe('1d ago')
    expect(relative('2026-09-10T00:00:00.000Z', '2026-09-15T12:00:00.000Z')).toBe('5d ago')
  })
  it('signs amounts', () => {
    expect(signedUsd(0)).toBe('+$0.00')
    expect(signedUsd(-3.5)).toBe('-$3.50')
  })
})

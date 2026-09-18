import { describe, expect, it } from 'vitest'
import { closedRows, holdingRows, queuedRows, units } from './page-rows'
import { closed, makeSummary } from '../test/summary-fixture'

describe('units', () => {
  it('shows a trailing stop on the holding row', () => {
    const s = makeSummary()
    const html = holdingRows({
      ...s,
      holdings: [{ ...s.holdings[0]!, trailPct: 3 }],
    })
    expect(html).toContain('stop $180.00 (trails 3%) &middot; target $240.00')
  })

  it('rounds to four places and names crypto by its ticker', () => {
    expect(units('AAPL', 2.5846257)).toBe('2.5846 shares')
    expect(units('AAPL', 1)).toBe('1 shares')
    expect(units('BTC/USD', 0.00123456)).toBe('0.0012 BTC')
    expect(units('AAPL260116C00190000', 1)).toBe('1 contract')
    expect(units('AAPL260116C00190000', 3)).toBe('3 contracts')
  })
})

describe('holdingRows', () => {
  it('shows ticker, fund, shares at cost, exits, value, dollar and percent change', () => {
    const html = holdingRows(makeSummary())
    expect(html).toContain(
      '<div class="row" data-symbol="AAPL" data-qty="0.5" data-entry="200" data-mult="1" data-price="220"><div class="lead"><div class="ticker">AAPL</div><div class="sub">Social &amp; signal</div></div><div class="detail num"><div>0.5 shares at $200.00</div><div>stop $180.00 &middot; target $240.00</div></div><div class="value"><div class="amount num">$110.00</div><div class="delta num up">+$10.00 (+10.00%)</div></div></div>',
    )
    expect(html).toContain(
      '<div class="ticker">BTC</div><div class="sub">Social &amp; signal</div></div><div class="detail num"><div>2 BTC at $25.00</div>',
    )
    expect(html).toContain('<div class="delta num down">-$1.00 (-1.96%)</div>')
    expect(html).toContain(
      '</div></div><div class="row" data-symbol="BTC/USD" data-qty="2" data-entry="25" data-mult="1" data-price="24.5"><div class="lead"><div class="ticker">BTC</div>',
    )
    expect(html).toContain('Cash $700.00</p>')
  })
  it('falls back to the fund id and a dash when the fund or cost basis is unknown', () => {
    const s = makeSummary()
    const html = holdingRows({
      ...s,
      funds: [],
      holdings: [{ ...s.holdings[0]!, fund: 'ghost', value: 10, unrealizedPl: 10 }],
    })
    expect(html).toContain('<div class="sub">ghost</div>')
    expect(html).toContain('<div class="delta num ">+$10.00</div>')
    expect(holdingRows({ ...s, holdings: [{ ...s.holdings[0]!, fund: 'old' }] })).toContain(
      '<div class="sub">Old</div>',
    )
    expect(holdingRows({ ...s, holdings: [], cash: 5 })).toBe(
      '<p class="muted num">All cash. $5.00</p>',
    )
  })
})

describe('queuedRows', () => {
  const queued = {
    fund: 'social',
    symbol: 'MSFT',
    qty: 2,
    notional: 25,
    limitPrice: 12.5,
    expiresAt: '2026-09-16T11:00:00.000Z',
    stop: 10,
    target: 15,
    horizon: '1 week',
    reason: 'r',
    openedAt: '2026-09-15T11:00:00.000Z',
  }
  it('renders nothing without queued orders', () => {
    expect(queuedRows(makeSummary())).toBe('')
  })
  it('renders limit and market orders that are waiting', () => {
    const html = queuedRows(
      makeSummary({
        queued: [
          queued,
          { ...queued, symbol: 'BTC/USD', qty: 0, notional: 40, limitPrice: null, expiresAt: null },
        ],
      }),
    )
    expect(html).toContain(
      '<section><h2>Queued</h2><div class="rows"><div class="row"><div class="lead"><div class="ticker">MSFT</div><div class="sub">Social &amp; signal</div></div><div class="detail num"><div>limit $12.50 for 2 shares until Sep 16</div><div>stop $10.00 &middot; target $15.00</div></div><div class="value"><div class="amount num">$25.00</div><div class="delta num muted">waiting</div></div></div>',
    )
    expect(html).toContain(
      '</div></div><div class="row"><div class="lead"><div class="ticker">BTC</div>',
    )
    expect(html).toContain('<div class="detail num"><div>market</div>')
    expect(html).toContain('<div class="amount num">$40.00</div>')
  })
})

describe('closedRows', () => {
  it('renders exit reason, hold time, size, dates and result', () => {
    const html = closedRows(
      makeSummary({
        closedTrades: [
          {
            ...closed,
            exitReason: 'target',
            openedAt: '2026-09-01T14:00:00.000Z',
            closedAt: '2026-09-05T14:00:00.000Z',
            qty: 2,
            entryPrice: 100,
            exitPrice: 110,
          },
        ],
      }),
    )
    expect(html).toContain('<div class="sub">Hit target in 4 days</div>')
    expect(html).toContain(
      '<div class="detail num"><div>2 BTC, $100.00 to $110.00</div><div>Sep 1 to Sep 5</div></div>',
    )
    expect(html).toContain(
      '<div class="value"><div class="amount num">$220.00</div><div class="delta num up">+$20.00 (+10.00%)</div></div>',
    )
    const two = closedRows(makeSummary({ closedTrades: [closed, { ...closed, id: 2 }] }))
    expect(two).toContain('</div></div><div class="row"><div class="lead">')
    expect(two.endsWith('</div></div></div>')).toBe(true)
  })
  it('names a stop, escapes an agent reason, and falls back when the exit is unknown', () => {
    const base = {
      ...closed,
      openedAt: '2026-09-01T14:00:00.000Z',
      closedAt: '2026-09-01T16:00:00.000Z',
      entryPrice: 100,
    }
    const stop = closedRows(
      makeSummary({ closedTrades: [{ ...base, exitReason: 'stop', exitPrice: 90 }] }),
    )
    expect(stop).toContain('Hit stop in 2 hours')
    expect(stop).toContain('<div class="delta num down">-$0.02 (-10.00%)</div>')
    const agent = closedRows(
      makeSummary({
        closedTrades: [
          { ...base, exitReason: '<b>thesis</b> broke', exitPrice: null, closedAt: null },
        ],
      }),
    )
    expect(agent).toContain('&lt;b&gt;thesis&lt;/b&gt; broke in 1 minute')
    expect(agent).toContain('<div>Sep 1 to Sep 1</div>')
    expect(agent).toContain('<div class="delta num up">+$0.00 (+0.00%)</div>')
    const blank = closedRows(
      makeSummary({ closedTrades: [{ ...base, exitReason: null, exitPrice: 100 }] }),
    )
    expect(blank).toContain('<div class="sub"> in 2 hours</div>')
  })
  it('pages with newer and older links that keep the horizon', () => {
    const middle = closedRows(makeSummary({ horizon: '1W', closedPage: { page: 2, pages: 3 } }))
    expect(middle).toContain(
      '<div class="pager num"><a href="/?h=1W&closed=1">Newer</a><span class="muted">Page 2 of 3</span><a href="/?h=1W&closed=3">Older</a></div>',
    )
    const first = closedRows(makeSummary({ closedPage: { page: 1, pages: 2 } }))
    expect(first).toContain(
      '<span></span><span class="muted">Page 1 of 2</span><a href="/?h=1M&closed=2">Older</a>',
    )
    const last = closedRows(makeSummary({ closedPage: { page: 2, pages: 2 } }))
    expect(last).toContain(
      '<a href="/?h=1M&closed=1">Newer</a><span class="muted">Page 2 of 2</span><span></span>',
    )
    expect(closedRows(makeSummary({ closedTrades: [] }))).toBe(
      '<p class="muted">Nothing closed yet.</p>',
    )
  })
})

import { describe, expect, it } from 'vitest'
import type { Trade } from './db/schema'
import { StateError } from './errors'
import { buyText, isPublishedExit, postText, sellText, ticker, label, optionParts } from './posts'
import { MISSING_AT_BROKER } from './reconcile'

const trade: Trade = {
  id: 1,
  fund: 'social',
  symbol: 'BTC/USD',
  assetClass: 'crypto',
  notional: 100,
  qty: 0.002,
  entryPrice: 50000,
  stop: 45000,
  target: 60000,
  trailPct: null,
  entryStop: null,
  liquidate: false,
  horizon: '2 weeks',
  reason: 'exchange inflows are surging',
  status: 'closed',
  orderId: 'o',
  limitPrice: null,
  expiresAt: null,
  closeOrderId: 'c',
  exitPrice: 55000,
  exitReason: 'target',
  openedAt: '2026-09-01T14:00:00.000Z',
  closedAt: '2026-09-03T15:00:00.000Z',
}

describe('ticker', () => {
  it('strips the quote currency', () => expect(ticker('BTC/USD')).toBe('BTC'))
  it('leaves stock symbols alone', () => expect(ticker('AAPL')).toBe('AAPL'))
  it('uses the root for option contracts', () => expect(ticker('AAPL260116C00190000')).toBe('AAPL'))
  it('describes option contracts and passes other symbols through', () => {
    expect(optionParts('AAPL260116C00190000')).toEqual({
      root: 'AAPL',
      expiry: 'Jan 16 2026',
      kind: 'call',
      strike: 190,
    })
    expect(optionParts('SPY261218P00450500')).toEqual({
      root: 'SPY',
      expiry: 'Dec 18 2026',
      kind: 'put',
      strike: 450.5,
    })
    expect(optionParts('AAPL')).toBeNull()
    expect(optionParts('X261301C00001000')?.expiry).toBe('13 1 2026')
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    months.forEach((name, i) => {
      const mm = String(i + 1).padStart(2, '0')
      expect(optionParts(`X26${mm}05C00001000`)?.expiry).toBe(`${name} 5 2026`)
    })
    expect(label('AAPL260116C00190000')).toBe('AAPL $190 call Jan 16 2026')
    expect(label('BTC/USD')).toBe('BTC')
    expect(label('AAPL')).toBe('AAPL')
  })
})

describe('buyText', () => {
  it('adds a full stop to the reason', () => {
    expect(buyText(trade)).toBe(
      'Buying $BTC because exchange inflows are surging. Will sell at $45000.00 or $60000.00. Expecting 2 weeks to profitability.',
    )
  })

  it('trims the reason and ends it with a full stop unless it already has one', () => {
    expect(buyText({ ...trade, reason: '  surging  ' })).toContain('because surging. Will')
    expect(buyText({ ...trade, reason: 'yes! really' })).toContain('because yes! really. Will')
    expect(buyText({ ...trade, reason: 'why?' })).toContain('because why? Will')
  })

  it('shows one dollar and up in cents', () => {
    expect(buyText({ ...trade, stop: 1, target: 9.999 })).toContain('at $1.00 or $10.00.')
  })

  it('keeps existing punctuation and shows small prices with three digits', () => {
    const penny = { ...trade, symbol: 'DOGE/USD', reason: 'Memes!', stop: 0.123456, target: 0.2 }
    expect(buyText(penny)).toBe(
      'Buying $DOGE because Memes! Will sell at $0.123 or $0.200. Expecting 2 weeks to profitability.',
    )
  })
})

describe('sellText', () => {
  it('refuses trades that are not closed', () => {
    expect(() => sellText({ ...trade, exitPrice: null })).toThrow(StateError)
    expect(() => sellText({ ...trade, exitReason: null })).toThrow('trade 1 is not closed')
    expect(() => sellText({ ...trade, closedAt: null })).toThrow(StateError)
  })

  it('describes a target exit', () => {
    expect(sellText(trade)).toBe(
      'Sold $BTC at $55000.00, +10.0% in 2 days (bought Sep 1 at $50000.00). Hit target.',
    )
  })

  it('describes a stop exit with a loss', () => {
    expect(sellText({ ...trade, exitPrice: 45000, exitReason: 'stop' })).toBe(
      'Sold $BTC at $45000.00, -10.0% in 2 days (bought Sep 1 at $50000.00). Hit stop.',
    )
  })

  it('signs a flat exit as a gain of zero', () => {
    expect(sellText({ ...trade, exitPrice: 50000, exitReason: 'stop' })).toContain(', +0.0% in')
  })

  it('describes a manual exit with the agent reason', () => {
    expect(sellText({ ...trade, exitReason: 'thesis broke' })).toMatch(/thesis broke\.$/)
  })
})

describe('isPublishedExit', () => {
  it('skips zero quantity trades', () => {
    expect(isPublishedExit({ ...trade, qty: 0 })).toBe(false)
  })
  it('skips trades missing at the broker', () => {
    expect(isPublishedExit({ ...trade, exitReason: MISSING_AT_BROKER })).toBe(false)
  })
  it('skips unfilled orders', () => {
    expect(isPublishedExit({ ...trade, exitReason: 'order canceled' })).toBe(false)
  })
  it('publishes real exits, even without a reason yet', () => {
    expect(isPublishedExit(trade)).toBe(true)
    expect(isPublishedExit({ ...trade, exitReason: null })).toBe(true)
  })
})

describe('postText', () => {
  it('routes by kind', () => {
    expect(postText(trade, 'buy')).toMatch(/^Buying/)
    expect(postText(trade, 'sell')).toMatch(/^Sold/)
  })
})

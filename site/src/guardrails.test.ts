import { describe, expect, it } from 'vitest'
import type { Account, Asset } from './alpaca'
import {
  GuardrailError,
  assertCanClose,
  assertExitsBracketPrice,
  assertSizing,
  assertTradable,
  minNotional,
} from './guardrails'

const asset: Asset = {
  symbol: 'AAPL',
  class: 'us_equity',
  tradable: true,
  fractionable: true,
  status: 'active',
}
const account: Account = { equity: 1000, cash: 500, daytrade_count: 0, pattern_day_trader: false }

const codeOf = (fn: () => void): string => {
  try {
    fn()
  } catch (error) {
    if (error instanceof GuardrailError) {
      return error.code
    }
    throw error
  }
  return 'ok'
}

describe('GuardrailError', () => {
  it('prefixes the message with its code', () => {
    const error = new GuardrailError('too_small', 'minimum is $1')
    expect(error.message).toBe('too_small: minimum is $1')
    expect(error.name).toBe('GuardrailError')
    expect(error.code).toBe('too_small')
  })
})

describe('assertTradable', () => {
  const check = {
    symbol: 'AAPL',
    asset,
    marketOpen: true,
    activeSymbols: [],
    fractional: true,
    queuesForOpen: false,
  }

  it('passes an active fractionable stock while the market is open', () => {
    expect(codeOf(() => assertTradable(check))).toBe('ok')
  })
  it('rejects inactive assets', () => {
    expect(() => assertTradable({ ...check, asset: { ...asset, status: 'inactive' } })).toThrow(
      'not_tradable: AAPL is not tradable on this venue',
    )
  })
  it('rejects untradable assets', () => {
    expect(codeOf(() => assertTradable({ ...check, asset: { ...asset, tradable: false } }))).toBe(
      'not_tradable',
    )
  })
  it('rejects fractional orders on whole-share stocks but allows whole quantities', () => {
    const whole = { ...check, asset: { ...asset, fractionable: false } }
    expect(() => assertTradable(whole)).toThrow(
      'not_fractionable: AAPL only trades in whole shares; give a whole qty',
    )
    expect(codeOf(() => assertTradable({ ...whole, fractional: false }))).toBe('ok')
    const contract = {
      ...whole,
      symbol: 'AAPL260116C00190000',
      asset: {
        ...asset,
        symbol: 'AAPL260116C00190000',
        class: 'us_option' as const,
        fractionable: false,
      },
    }
    expect(() => assertTradable(contract)).toThrow(
      'not_fractionable: AAPL260116C00190000 only trades in whole contracts; give a whole qty',
    )
  })
  it('lets crypto skip the fractionable and market checks', () => {
    const crypto = { ...asset, class: 'crypto' as const, fractionable: false }
    expect(
      codeOf(() =>
        assertTradable({ ...check, symbol: 'BTC/USD', asset: crypto, marketOpen: false }),
      ),
    ).toBe('ok')
  })
  it('rejects stocks while the market is closed unless the order queues for the open', () => {
    expect(() => assertTradable({ ...check, marketOpen: false })).toThrow(
      'market_closed: the market is closed: queue a whole-share limit order for the next session, or trade crypto',
    )
    expect(codeOf(() => assertTradable({ ...check, marketOpen: false, queuesForOpen: true }))).toBe(
      'ok',
    )
  })
  it('rejects a symbol that already has a position', () => {
    expect(() => assertTradable({ ...check, activeSymbols: ['AAPL'] })).toThrow(
      'already_open: AAPL is already held by this fund; adjust or close that lot instead',
    )
  })
})

describe('assertSizing', () => {
  const sizing = {
    symbol: 'AAPL',
    notional: 100,
    account,
    fundName: 'Social',
    fundCap: 500,
    fundDeployed: 0,
  }

  it('sets the minimum by asset class', () => {
    expect(minNotional('AAPL')).toBe(1)
    expect(minNotional('BTC/USD')).toBe(10)
  })

  it('passes an order inside every limit', () => {
    expect(codeOf(() => assertSizing(sizing))).toBe('ok')
  })
  it('rejects tiny orders', () => {
    expect(() => assertSizing({ ...sizing, notional: 0.5 })).toThrow(
      'too_small: minimum order for AAPL is $1',
    )
    expect(codeOf(() => assertSizing({ ...sizing, symbol: 'BTC/USD', notional: 5 }))).toBe(
      'too_small',
    )
    expect(codeOf(() => assertSizing({ ...sizing, symbol: 'BTC/USD', notional: 10 }))).toBe('ok')
  })
  it('allows exactly a quarter of equity and rejects a cent more', () => {
    expect(codeOf(() => assertSizing({ ...sizing, notional: 250 }))).toBe('ok')
    expect(() => assertSizing({ ...sizing, notional: 250.01 })).toThrow(
      'too_large: max 25% of equity = $250.00 per position',
    )
  })
  it('allows spending every cent of cash and rejects a cent more', () => {
    const poor = { ...account, equity: 10000, cash: 100 }
    expect(codeOf(() => assertSizing({ ...sizing, account: poor, notional: 100 }))).toBe('ok')
    expect(() => assertSizing({ ...sizing, account: poor, notional: 100.01 })).toThrow(
      'insufficient_cash: cash is $100.00; no margin',
    )
  })
  it('allows filling the fund cap exactly and rejects a cent more', () => {
    expect(codeOf(() => assertSizing({ ...sizing, fundDeployed: 400 }))).toBe('ok')
    expect(() => assertSizing({ ...sizing, fundDeployed: 450 })).toThrow(
      'fund_cap: Social fund has $50.00 of its $500.00 cap left',
    )
  })
})

describe('assertExitsBracketPrice', () => {
  it('passes when the stop is below and the target above', () => {
    expect(codeOf(() => assertExitsBracketPrice(90, 110, 100))).toBe('ok')
  })
  it('rejects a stop at or above price', () => {
    expect(() => assertExitsBracketPrice(100, 110, 100)).toThrow(
      'bad_stop: stop 100 must be below current price 100',
    )
  })
  it('rejects a target at or below price', () => {
    expect(() => assertExitsBracketPrice(90, 100, 100)).toThrow(
      'bad_target: target 100 must be above current price 100',
    )
  })
})

describe('assertCanClose', () => {
  const now = new Date('2026-09-01T18:00:00Z')
  const sameDay = '2026-09-01T14:00:00Z'

  it('always allows crypto', () => {
    const limited = { ...account, daytrade_count: 3 }
    expect(codeOf(() => assertCanClose('BTC/USD', sameDay, limited, now))).toBe('ok')
  })
  it('allows a same-day stock sale under the limit', () => {
    expect(codeOf(() => assertCanClose('AAPL', sameDay, account, now))).toBe('ok')
  })
  it('allows a next-day sale even at the limit', () => {
    const limited = { ...account, daytrade_count: 3 }
    expect(codeOf(() => assertCanClose('AAPL', '2026-08-31T14:00:00Z', limited, now))).toBe('ok')
  })
  it('allows a same-day sale at the limit with enough equity', () => {
    const rich = { ...account, equity: 30000, daytrade_count: 3 }
    expect(codeOf(() => assertCanClose('AAPL', sameDay, rich, now))).toBe('ok')
    const atFloor = { ...account, equity: 25000, daytrade_count: 3 }
    expect(codeOf(() => assertCanClose('AAPL', sameDay, atFloor, now))).toBe('ok')
  })
  it('blocks the fourth day trade under the equity floor', () => {
    const limited = { ...account, equity: 24999.99, daytrade_count: 3 }
    expect(() => assertCanClose('AAPL', sameDay, limited, now)).toThrow(
      'day_trade_limit: selling AAPL today would be day trade #4; limit is 3 per 5 days under $25000',
    )
  })
})

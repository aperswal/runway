import type { Account, Asset } from './alpaca'
import { isCrypto, isOption } from './symbols'
import { easternDay } from './time'

export const MAX_POSITION_FRACTION = 0.25
export const MIN_STOCK_NOTIONAL = 1
export const MIN_CRYPTO_NOTIONAL = 10
export const PDT_EQUITY_FLOOR = 25_000
export const MAX_DAY_TRADES = 3
const PERCENT = 100
const CENTS = 2

export class GuardrailError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'GuardrailError'
    this.code = code
  }
}

export type TradableCheck = {
  symbol: string
  asset: Asset
  marketOpen: boolean
  activeSymbols: string[]
  fractional: boolean
  queuesForOpen: boolean
}

function assertAssetOk(c: TradableCheck): void {
  if (c.asset.status !== 'active' || !c.asset.tradable) {
    throw new GuardrailError('not_tradable', `${c.symbol} is not tradable on this venue`)
  }
  if (!isCrypto(c.symbol) && !c.asset.fractionable && c.fractional) {
    throw new GuardrailError(
      'not_fractionable',
      `${c.symbol} only trades in whole ${isOption(c.symbol) ? 'contracts' : 'shares'}; give a whole qty`,
    )
  }
}

export function assertTradable(c: TradableCheck): void {
  assertAssetOk(c)
  if (!isCrypto(c.symbol) && !c.marketOpen && !c.queuesForOpen) {
    throw new GuardrailError(
      'market_closed',
      'the market is closed: queue a whole-share limit order for the next session, or trade crypto',
    )
  }
  if (c.activeSymbols.includes(c.symbol)) {
    throw new GuardrailError(
      'already_open',
      `${c.symbol} is already held by this fund; adjust or close that lot instead`,
    )
  }
}

export const minNotional = (symbol: string): number =>
  isCrypto(symbol) ? MIN_CRYPTO_NOTIONAL : MIN_STOCK_NOTIONAL

export type SizingCheck = {
  symbol: string
  notional: number
  account: Account
  fundName: string
  fundCap: number
  fundDeployed: number
}

export function assertSizing(c: SizingCheck): void {
  const maxNotional = c.account.equity * MAX_POSITION_FRACTION
  if (c.notional < minNotional(c.symbol)) {
    throw new GuardrailError(
      'too_small',
      `minimum order for ${c.symbol} is $${minNotional(c.symbol)}`,
    )
  }
  if (c.notional > maxNotional) {
    const limit = `${MAX_POSITION_FRACTION * PERCENT}% of equity = $${maxNotional.toFixed(CENTS)}`
    throw new GuardrailError('too_large', `max ${limit} per position`)
  }
  if (c.notional > c.account.cash) {
    throw new GuardrailError(
      'insufficient_cash',
      `cash is $${c.account.cash.toFixed(CENTS)}; no margin`,
    )
  }
  const room = c.fundCap - c.fundDeployed
  if (c.notional > room) {
    const detail = `${c.fundName} fund has $${room.toFixed(CENTS)} of its $${c.fundCap.toFixed(CENTS)} cap left`
    throw new GuardrailError('fund_cap', detail)
  }
}

export function assertExitsBracketPrice(stop: number, target: number, price: number): void {
  if (stop >= price) {
    throw new GuardrailError('bad_stop', `stop ${stop} must be below current price ${price}`)
  }
  if (target <= price) {
    throw new GuardrailError('bad_target', `target ${target} must be above current price ${price}`)
  }
}

export function assertCanClose(
  symbol: string,
  openedAt: string,
  account: Account,
  now: Date,
): void {
  if (isCrypto(symbol)) {
    return
  }
  const sameDay = easternDay(new Date(openedAt)) === easternDay(now)
  const limited = account.equity < PDT_EQUITY_FLOOR && account.daytrade_count >= MAX_DAY_TRADES
  if (sameDay && limited) {
    const detail = `selling ${symbol} today would be day trade #${account.daytrade_count + 1}; limit is ${MAX_DAY_TRADES} per 5 days under $${PDT_EQUITY_FLOOR}`
    throw new GuardrailError('day_trade_limit', detail)
  }
}

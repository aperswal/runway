import {
  canonicalSymbol,
  hashSymbol,
  isCrypto,
  multiplierOf,
  positionSymbol,
  roundQty,
} from './prices.ts'
import type { AlpacaState, OrderRecord, PositionRecord } from './state.ts'
import { assetClassOf } from './state.ts'

const MONEY_PLACES = 2
const HEX = 16
const UUID_HEAD_LENGTH = 8
const UUID_TAIL_LENGTH = 12
const MAINTENANCE_MARGIN_PERCENT = 100

const money = (value: number): string => value.toFixed(MONEY_PLACES)
const quantity = (value: number): string => String(roundQty(value))

const assetId = (symbol: string): string => {
  const hex = hashSymbol(canonicalSymbol(symbol)).toString(HEX).padStart(UUID_HEAD_LENGTH, '0')
  return `${hex}-0000-4000-8000-${`${hex}${hex}`.slice(0, UUID_TAIL_LENGTH)}`
}

const exchangeOf = (symbol: string): string => (isCrypto(symbol) ? 'CRYPTO' : 'NASDAQ')

export function accountView(state: AlpacaState, createdAt: string): Record<string, unknown> {
  const cash = money(state.cash)
  const equity = money(state.equity())
  return {
    id: 'mock-account',
    account_number: 'MOCK000001',
    status: 'ACTIVE',
    crypto_status: 'ACTIVE',
    currency: 'USD',
    buying_power: cash,
    regt_buying_power: cash,
    daytrading_buying_power: '0',
    non_marginable_buying_power: cash,
    cash,
    accrued_fees: '0',
    pending_transfer_in: '0',
    portfolio_value: equity,
    pattern_day_trader: false,
    trading_blocked: false,
    transfers_blocked: false,
    account_blocked: false,
    created_at: createdAt,
    trade_suspended_by_user: false,
    multiplier: '1',
    shorting_enabled: false,
    equity,
    last_equity: money(state.startCash),
    long_market_value: money(state.marketValue()),
    short_market_value: '0',
    initial_margin: '0',
    maintenance_margin: '0',
    last_maintenance_margin: '0',
    sma: '0',
    daytrade_count: 0,
  }
}

export function positionView(position: PositionRecord, price: number): Record<string, unknown> {
  const size = multiplierOf(position.symbol)
  const marketValue = position.qty * price * size
  const costBasis = position.qty * position.avgEntryPrice * size
  const unrealized = marketValue - costBasis
  const unrealizedPercent = unrealized / costBasis
  return {
    asset_id: assetId(position.symbol),
    symbol: positionSymbol(position.symbol),
    exchange: exchangeOf(position.symbol),
    asset_class: assetClassOf(position.symbol),
    asset_marginable: false,
    qty: quantity(position.qty),
    avg_entry_price: quantity(position.avgEntryPrice),
    side: 'long',
    market_value: money(marketValue),
    cost_basis: money(costBasis),
    unrealized_pl: money(unrealized),
    unrealized_plpc: quantity(unrealizedPercent),
    unrealized_intraday_pl: money(unrealized),
    unrealized_intraday_plpc: quantity(unrealizedPercent),
    current_price: money(price),
    lastday_price: quantity(position.avgEntryPrice),
    change_today: quantity(unrealizedPercent),
    qty_available: quantity(position.qty),
  }
}

const nullableMoney = (value: number | null): string | null =>
  value === null ? null : money(value)

export function orderView(order: OrderRecord): Record<string, unknown> {
  const filled = order.status === 'filled'
  const type = order.limitPrice === null ? 'market' : 'limit'
  return {
    id: order.id,
    client_order_id: order.id,
    created_at: order.createdAt,
    updated_at: order.createdAt,
    submitted_at: order.createdAt,
    filled_at: filled ? order.createdAt : null,
    expired_at: null,
    canceled_at: null,
    failed_at: null,
    replaced_at: null,
    replaced_by: null,
    replaces: null,
    asset_id: assetId(order.symbol),
    symbol: order.symbol,
    asset_class: order.assetClass,
    notional: order.notional === null ? null : money(order.notional),
    qty: order.notional === null ? quantity(order.qty) : null,
    filled_qty: filled ? quantity(order.qty) : '0',
    filled_avg_price: nullableMoney(order.filledAvgPrice),
    order_class: 'simple',
    order_type: type,
    type,
    side: order.side,
    time_in_force: order.timeInForce,
    limit_price: nullableMoney(order.limitPrice),
    stop_price: null,
    status: order.status,
    extended_hours: false,
    legs: null,
    trail_percent: null,
    trail_price: null,
    hwm: null,
  }
}

export function assetView(symbol: string): Record<string, unknown> {
  const canonical = canonicalSymbol(symbol)
  const crypto = isCrypto(canonical)
  return {
    id: assetId(canonical),
    class: assetClassOf(canonical),
    exchange: exchangeOf(canonical),
    symbol: canonical,
    name: `${canonical} (mock)`,
    status: 'active',
    tradable: true,
    marginable: !crypto,
    shortable: false,
    easy_to_borrow: false,
    fractionable: true,
    maintenance_margin_requirement: MAINTENANCE_MARGIN_PERCENT,
    attributes: [],
  }
}

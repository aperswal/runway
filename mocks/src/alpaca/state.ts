import {
  InsufficientBuyingPowerError,
  InsufficientQtyError,
  OrderNotCancelableError,
  OrderNotFoundError,
  PositionNotFoundError,
} from '../errors.ts'
import {
  canonicalSymbol,
  isCrypto,
  isOptionSymbol,
  multiplierOf,
  roundCents,
  roundQty,
  type PriceFeed,
} from './prices.ts'

export type AssetClass = 'us_equity' | 'crypto' | 'us_option'
type OrderSide = 'buy' | 'sell'

export type PositionRecord = { symbol: string; qty: number; avgEntryPrice: number }

export type OrderAmount = { kind: 'qty'; qty: number } | { kind: 'notional'; notional: number }

export type OrderRequest = {
  symbol: string
  side: OrderSide
  amount: OrderAmount
  timeInForce: string
  limitPrice: number | null
}

type OrderStatus = 'filled' | 'new' | 'canceled'

export type OrderRecord = {
  id: string
  symbol: string
  assetClass: AssetClass
  side: OrderSide
  qty: number
  notional: number | null
  filledAvgPrice: number | null
  limitPrice: number | null
  status: OrderStatus
  timeInForce: string
  createdAt: string
}

export function assetClassOf(symbol: string): AssetClass {
  if (isCrypto(symbol)) {
    return 'crypto'
  }
  return isOptionSymbol(symbol) ? 'us_option' : 'us_equity'
}

const requested = (amount: OrderAmount): { qty: number; notional: number | null } =>
  amount.kind === 'qty'
    ? { qty: amount.qty, notional: null }
    : { qty: 0, notional: amount.notional }

const marketable = (order: OrderRecord, price: number): boolean =>
  order.limitPrice === null ||
  (order.side === 'buy' ? price <= order.limitPrice : price >= order.limitPrice)

export class AlpacaState {
  cash: number
  readonly startCash: number
  readonly prices: PriceFeed
  positions = new Map<string, PositionRecord>()
  orders: OrderRecord[] = []
  private readonly now: () => Date

  constructor(startCash: number, prices: PriceFeed, now: () => Date) {
    this.cash = startCash
    this.startCash = startCash
    this.prices = prices
    this.now = now
  }

  reset(): void {
    this.cash = this.startCash
    this.positions = new Map()
    this.orders = []
    this.prices.reset()
  }

  submit(request: OrderRequest): OrderRecord {
    const symbol = canonicalSymbol(request.symbol)
    const order: OrderRecord = {
      id: crypto.randomUUID(),
      symbol,
      assetClass: assetClassOf(symbol),
      side: request.side,
      ...requested(request.amount),
      filledAvgPrice: null,
      limitPrice: request.limitPrice,
      status: 'new',
      timeInForce: request.timeInForce,
      createdAt: this.now().toISOString(),
    }
    this.settle(order)
    this.orders.push(order)
    return order
  }

  private settle(order: OrderRecord): void {
    const price = this.prices.current(order.symbol)
    if (order.status !== 'new' || !marketable(order, price)) {
      return
    }
    const qty = order.notional === null ? order.qty : order.notional / price
    if (order.side === 'buy') {
      this.applyBuy(order.symbol, qty, price)
    } else {
      this.applySell(order.symbol, qty)
    }
    const size = multiplierOf(order.symbol)
    this.cash = roundCents(this.cash + (order.side === 'buy' ? -1 : 1) * qty * price * size)
    order.qty = qty
    order.filledAvgPrice = price
    order.status = 'filled'
  }

  cancel(id: string): OrderRecord {
    const order = this.order(id)
    if (order.status !== 'new') {
      throw new OrderNotCancelableError()
    }
    order.status = 'canceled'
    return order
  }

  closePosition(symbol: string): OrderRecord {
    const position = this.position(symbol)
    return this.submit({
      symbol: position.symbol,
      side: 'sell',
      amount: { kind: 'qty', qty: position.qty },
      timeInForce: assetClassOf(position.symbol) === 'crypto' ? 'gtc' : 'day',
      limitPrice: null,
    })
  }

  position(symbol: string): PositionRecord {
    const position = this.positions.get(canonicalSymbol(symbol))
    if (position === undefined) {
      throw new PositionNotFoundError()
    }
    return position
  }

  order(id: string): OrderRecord {
    const order = this.orders.find((o) => o.id === id)
    if (order === undefined) {
      throw new OrderNotFoundError()
    }
    try {
      this.settle(order)
    } catch {
      order.status = 'canceled'
    }
    return order
  }

  marketValue(): number {
    let total = 0
    for (const position of this.positions.values()) {
      total += position.qty * this.prices.current(position.symbol) * multiplierOf(position.symbol)
    }
    return roundCents(total)
  }

  equity(): number {
    return roundCents(this.cash + this.marketValue())
  }

  private applyBuy(symbol: string, qty: number, price: number): void {
    const cost = qty * price * multiplierOf(symbol)
    if (roundCents(cost) > this.cash) {
      throw new InsufficientBuyingPowerError()
    }
    const existing = this.positions.get(symbol)
    if (existing === undefined) {
      this.positions.set(symbol, { symbol, qty, avgEntryPrice: price })
      return
    }
    const totalQty = existing.qty + qty
    existing.avgEntryPrice = (existing.qty * existing.avgEntryPrice + cost) / totalQty
    existing.qty = totalQty
  }

  private applySell(symbol: string, qty: number): void {
    const existing = this.position(symbol)
    const remaining = roundQty(existing.qty - qty)
    if (remaining < 0) {
      throw new InsufficientQtyError()
    }
    if (remaining === 0) {
      this.positions.delete(symbol)
      return
    }
    existing.qty = remaining
  }
}

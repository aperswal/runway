import { beforeEach, describe, expect, it } from 'vitest'
import {
  InsufficientBuyingPowerError,
  InsufficientQtyError,
  OrderNotCancelableError,
  OrderNotFoundError,
  PositionNotFoundError,
} from '../errors.ts'
import { PriceFeed, roundCents } from './prices.ts'
import { AlpacaState, assetClassOf, type OrderRequest } from './state.ts'

const NOW = new Date('2026-09-01T15:00:00.000Z')

const buyQty = (symbol: string, qty: number): OrderRequest => ({
  symbol,
  side: 'buy',
  amount: { kind: 'qty', qty },
  timeInForce: 'day',
  limitPrice: null,
})
const notional = (symbol: string, side: 'buy' | 'sell', amount: number): OrderRequest => ({
  symbol,
  side,
  amount: { kind: 'notional', notional: amount },
  timeInForce: 'day',
  limitPrice: null,
})

describe('AlpacaState', () => {
  let state: AlpacaState

  beforeEach(() => {
    state = new AlpacaState(1000, new PriceFeed(), () => NOW)
    state.prices.set('AAPL', 100)
    state.prices.set('BTC/USD', 50)
  })

  it('fills notional buys at the drifted price and tracks cash and equity', () => {
    const order = state.submit(notional('AAPL', 'buy', 200))
    const price = order.filledAvgPrice ?? 0
    expect(price).not.toBe(100)
    expect(order).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      symbol: 'AAPL',
      assetClass: 'us_equity',
      side: 'buy',
      qty: 200 / price,
      notional: 200,
      filledAvgPrice: price,
      limitPrice: null,
      status: 'filled',
      timeInForce: 'day',
      createdAt: '2026-09-01T15:00:00.000Z',
    })
    expect(state.cash).toBe(roundCents(1000 - (200 / price) * price))
    expect(state.position('AAPL')).toEqual({
      symbol: 'AAPL',
      qty: 200 / price,
      avgEntryPrice: price,
    })
    expect(Math.abs(state.equity() - 1000)).toBeLessThan(5)
    expect(state.order(order.id)).toBe(order)
    expect(state.orders).toEqual([order])
  })

  it('fills qty buys and reports no notional', () => {
    const order = state.submit(buyQty('AAPL', 2))
    expect(order.qty).toBe(2)
    expect(order.notional).toBeNull()
    expect(state.cash).toBe(roundCents(1000 - 2 * (order.filledAvgPrice ?? 0)))
  })

  it('averages the entry price across buys', () => {
    const first = state.submit(buyQty('AAPL', 1))
    state.prices.set('AAPL', 200)
    const second = state.submit(buyQty('AAPL', 1))
    expect(state.position('AAPL')).toEqual({
      symbol: 'AAPL',
      qty: 2,
      avgEntryPrice: ((first.filledAvgPrice ?? 0) + (second.filledAvgPrice ?? 0)) / 2,
    })
  })

  it('allows spending every cent and rejects one more', () => {
    const probe = new PriceFeed()
    probe.set('AAPL', 100)
    const price = probe.current('AAPL')
    state.cash = roundCents(10 * price)
    state.submit(buyQty('AAPL', 10))
    expect(state.cash).toBeCloseTo(0, 9)
    expect(() => state.submit(buyQty('AAPL', 0.001))).toThrow(InsufficientBuyingPowerError)
  })

  it('rejects buys over the available cash', () => {
    expect(() => state.submit(notional('AAPL', 'buy', 2000))).toThrow(InsufficientBuyingPowerError)
    expect(state.positions.size).toBe(0)
    expect(state.orders).toEqual([])
    expect(state.cash).toBe(1000)
  })

  it('sells partially and fully', () => {
    const bought = state.submit({ ...buyQty('btcusd', 2), timeInForce: 'gtc' })
    const sold = state.submit({ ...buyQty('BTC/USD', 1), side: 'sell', timeInForce: 'gtc' })
    expect(state.position('BTCUSD').qty).toBe(1)
    const close = state.closePosition('BTCUSD')
    expect(close).toMatchObject({ symbol: 'BTC/USD', side: 'sell', qty: 1, timeInForce: 'gtc' })
    expect(state.positions.size).toBe(0)
    const proceeds =
      (sold.filledAvgPrice ?? 0) + (close.filledAvgPrice ?? 0) - 2 * (bought.filledAvgPrice ?? 0)
    expect(state.cash).toBe(roundCents(1000 + proceeds))
  })

  it('queues limit buys above the market and fills them when the price comes down', () => {
    state.prices.set('AAPL', 100)
    const order = state.submit({ ...buyQty('AAPL', 2), limitPrice: 90 })
    expect(order).toMatchObject({ status: 'new', filledAvgPrice: null, limitPrice: 90, qty: 2 })
    expect(state.positions.size).toBe(0)
    expect(state.cash).toBe(1000)
    expect(state.order(order.id).status).toBe('new')
    state.prices.set('AAPL', 85)
    const filled = state.order(order.id)
    expect(filled).toMatchObject({ status: 'filled', qty: 2 })
    expect(filled.filledAvgPrice).toBeLessThan(90)
    expect(state.cash).toBe(roundCents(1000 - 2 * (filled.filledAvgPrice ?? 0)))
    expect(state.position('AAPL').qty).toBe(2)
    expect(state.order(order.id).status).toBe('filled')
  })

  it('fills limit buys at once when the limit is at or above the market', () => {
    const order = state.submit({ ...buyQty('AAPL', 1), limitPrice: 200 })
    expect(order.status).toBe('filled')
    const probe = new PriceFeed()
    probe.set('AAPL', 100)
    const next = probe.current('AAPL')
    const fresh = new AlpacaState(1000, new PriceFeed(), () => NOW)
    fresh.prices.set('AAPL', 100)
    const exact = fresh.submit({ ...buyQty('AAPL', 1), limitPrice: next })
    expect(exact).toMatchObject({ status: 'filled', filledAvgPrice: next })
  })

  it('fills limit sells only when the price reaches the limit', () => {
    state.submit(buyQty('AAPL', 2))
    state.prices.set('AAPL', 100)
    const sell = state.submit({ ...buyQty('AAPL', 1), side: 'sell', limitPrice: 150 })
    expect(sell.status).toBe('new')
    state.prices.set('AAPL', 160)
    expect(state.order(sell.id).status).toBe('filled')
    expect(state.position('AAPL').qty).toBe(1)
    const probe = new PriceFeed()
    probe.set('AAPL', 100)
    probe.current('AAPL')
    const next = probe.current('AAPL')
    const fresh = new AlpacaState(1000, new PriceFeed(), () => NOW)
    fresh.prices.set('AAPL', 100)
    fresh.submit(buyQty('AAPL', 1))
    const exact = fresh.submit({ ...buyQty('AAPL', 1), side: 'sell', limitPrice: next })
    expect(exact).toMatchObject({ status: 'filled', filledAvgPrice: next })
  })

  it('cancels queued orders but not filled ones', () => {
    const queued = state.submit({ ...buyQty('AAPL', 1), limitPrice: 50 })
    expect(state.cancel(queued.id).status).toBe('canceled')
    expect(() => state.cancel(queued.id)).toThrow(OrderNotCancelableError)
    const filled = state.submit(buyQty('AAPL', 1))
    expect(() => state.cancel(filled.id)).toThrow(OrderNotCancelableError)
    expect(() => state.cancel('missing')).toThrow(OrderNotFoundError)
    state.prices.set('AAPL', 40)
    expect(state.order(queued.id).status).toBe('canceled')
  })

  it('cancels a queued order that can no longer be afforded when it would fill', () => {
    const queued = state.submit({ ...buyQty('AAPL', 20), limitPrice: 90 })
    const bought = state.submit(notional('AAPL', 'buy', 900))
    state.prices.set('AAPL', 80)
    expect(state.order(queued.id).status).toBe('canceled')
    expect(state.position('AAPL').qty).toBe(bought.qty)
  })

  it('charges option premiums times the contract multiplier', () => {
    const symbol = 'AAPL260116C00190000'
    state.prices.set(symbol, 2)
    const order = state.submit(buyQty(symbol, 1))
    expect(order.assetClass).toBe('us_option')
    expect(state.cash).toBe(roundCents(1000 - (order.filledAvgPrice ?? 0) * 100))
    expect(state.equity()).toBeGreaterThan(900)
    expect(() => state.submit(buyQty(symbol, 10))).toThrow(InsufficientBuyingPowerError)
  })

  it('closes stock positions with a day order', () => {
    state.submit(buyQty('AAPL', 1))
    expect(state.closePosition('AAPL').timeInForce).toBe('day')
  })

  it('rejects selling more than held or unknown positions', () => {
    state.submit(buyQty('AAPL', 1))
    expect(() => state.submit({ ...buyQty('AAPL', 1.000000001), side: 'sell' })).toThrow(
      InsufficientQtyError,
    )
    expect(state.position('AAPL').qty).toBe(1)
    expect(() => state.closePosition('MSFT')).toThrow(PositionNotFoundError)
    expect(() => state.order('missing')).toThrow(OrderNotFoundError)
  })

  it('treats sub-nano residue as fully sold', () => {
    state.submit(buyQty('AAPL', 1))
    state.submit({ ...buyQty('AAPL', 0.9999999999), side: 'sell' })
    expect(state.positions.size).toBe(0)
  })

  it('sells by notional and keeps the rounded remainder', () => {
    state.submit(buyQty('AAPL', 2))
    const sale = state.submit(notional('AAPL', 'sell', 50))
    expect(sale.qty).toBe(50 / (sale.filledAvgPrice ?? 0))
    expect(state.position('AAPL').qty).toBe(Number((2 - sale.qty).toFixed(9)))
  })

  it('resets to the starting state', () => {
    state.submit(buyQty('AAPL', 1))
    state.reset()
    expect(state.cash).toBe(1000)
    expect(state.orders).toEqual([])
    expect(state.positions.size).toBe(0)
    expect(state.prices.snapshot()).toEqual({})
  })

  it('classifies assets', () => {
    expect(assetClassOf('ETH/USD')).toBe('crypto')
    expect(assetClassOf('TSLA')).toBe('us_equity')
  })
})

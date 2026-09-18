import { beforeEach, describe, expect, it } from 'vitest'
import { AlpacaUnprocessableError } from '../errors.ts'
import { alpacaCall, readJson, setup, type Call } from '../test-support.ts'
import { parseOrder } from './trading.ts'

type Order = {
  id: string
  qty: string | null
  notional: string | null
  filled_qty: string
  filled_avg_price: string
  asset_class: string
  time_in_force: string
}
type Position = { symbol: string; unrealized_pl: string; unrealized_plpc: string }
type Asset = { id: string }
type Clock = { is_open: boolean }

const buy = (symbol: string, notional: string) => ({
  symbol,
  notional,
  side: 'buy',
  type: 'market',
  time_in_force: symbol.includes('/') ? 'gtc' : 'day',
})

describe('parseOrder', () => {
  it('requires exactly one of qty and notional', () => {
    expect(() => parseOrder({ ...buy('AAPL', '10'), qty: '1' })).toThrow(AlpacaUnprocessableError)
    const neither = { symbol: 'AAPL', side: 'buy', type: 'market', time_in_force: 'day' }
    expect(() => parseOrder(neither)).toThrow('exactly one of qty or notional is required')
    expect(() => parseOrder({ ...neither, type: 'limit' })).toThrow(AlpacaUnprocessableError)
  })

  it('joins every validation message', () => {
    expect(() => parseOrder({ symbol: 'AAPL' })).toThrow(
      'Invalid option: expected one of "buy"|"sell"; Invalid option: expected one of "market"|"limit"; Invalid option: expected one of "day"|"gtc"|"ioc"|"fok"|"opg"|"cls"',
    )
  })

  it('coerces string numbers', () => {
    expect(parseOrder(buy('AAPL', '12.50'))).toEqual({
      symbol: 'AAPL',
      amount: { kind: 'notional', notional: 12.5 },
      side: 'buy',
      timeInForce: 'day',
      limitPrice: null,
    })
    const qty = parseOrder({ ...buy('AAPL', '1'), notional: undefined, qty: '3' })
    expect(qty.amount).toEqual({ kind: 'qty', qty: 3 })
  })

  it('accepts the extended hours flag', () => {
    const limit = { symbol: 'AAPL', qty: '2', side: 'sell', type: 'limit', time_in_force: 'day' }
    expect(parseOrder({ ...limit, limit_price: '95.50', extended_hours: true })).toMatchObject({
      side: 'sell',
      limitPrice: 95.5,
    })
  })

  it('parses limit orders and rejects half-specified ones', () => {
    const limit = { symbol: 'AAPL', qty: '2', side: 'buy', type: 'limit', time_in_force: 'gtc' }
    expect(parseOrder({ ...limit, limit_price: '95.50' })).toMatchObject({
      amount: { kind: 'qty', qty: 2 },
      limitPrice: 95.5,
    })
    expect(() => parseOrder(limit)).toThrow('limit orders need limit_price')
    expect(() => parseOrder({ ...buy('AAPL', '10'), limit_price: '9' })).toThrow(
      'limit orders need limit_price; market orders must not have one',
    )
    expect(() =>
      parseOrder({ ...limit, qty: undefined, notional: '10', limit_price: '9' }),
    ).toThrow('limit orders need qty')
  })

  it('accepts every side and time in force', () => {
    for (const timeInForce of ['day', 'gtc', 'ioc', 'fok', 'opg', 'cls']) {
      const order = parseOrder({ ...buy('AAPL', '1'), side: 'sell', time_in_force: timeInForce })
      expect(order).toMatchObject({ side: 'sell', timeInForce })
    }
    expect(() => parseOrder({ ...buy('AAPL', '1'), time_in_force: 'week' })).toThrow(
      AlpacaUnprocessableError,
    )
  })
})

describe('trading api', () => {
  let call: Call

  beforeEach(() => {
    const built = setup()
    call = alpacaCall(built.call)
    built.deps.state.prices.set('AAPL', 100)
    built.deps.state.prices.set('BTC/USD', 50)
  })

  it('requires both api key headers', async () => {
    const built = setup()
    const missing = await built.call('GET', '/alpaca/v2/account', {
      headers: { 'apca-api-key-id': 'k' },
    })
    expect(missing.status).toBe(401)
    expect(await missing.json()).toEqual({ message: 'unauthorized.' })
    const blank = await built.call('GET', '/alpaca/v2/account', {
      headers: { 'apca-api-key-id': 'k', 'apca-api-secret-key': ' ' },
    })
    expect(blank.status).toBe(401)
    const noKey = await built.call('GET', '/alpaca/v2/account', {
      headers: { 'apca-api-secret-key': 's' },
    })
    expect(noKey.status).toBe(401)
  })

  it('serves the account with string encoded money', async () => {
    const res = await call('GET', '/alpaca/v2/account')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.json()).toMatchObject({
      cash: '1000.00',
      equity: '1000.00',
      buying_power: '1000.00',
      portfolio_value: '1000.00',
      last_equity: '1000.00',
      daytrade_count: 0,
      pattern_day_trader: false,
      status: 'ACTIVE',
      currency: 'USD',
      created_at: '2026-09-01T15:00:00.000Z',
    })
  })

  it('fills market buys immediately and lists positions', async () => {
    const res = await call('POST', '/alpaca/v2/orders', { body: buy('BTC/USD', '100.00') })
    expect(res.status).toBe(200)
    const order = await readJson<Order>(res)
    expect(order).toMatchObject({
      symbol: 'BTC/USD',
      asset_class: 'crypto',
      status: 'filled',
      side: 'buy',
      type: 'market',
      time_in_force: 'gtc',
      notional: '100.00',
      qty: null,
      created_at: '2026-09-01T15:00:00.000Z',
    })
    expect(Number(order.filled_qty) * Number(order.filled_avg_price)).toBeCloseTo(100)
    const positions = await readJson<Position[]>(await call('GET', '/alpaca/v2/positions'))
    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({ symbol: 'BTCUSD', asset_class: 'crypto', side: 'long' })
    const [held] = positions
    expect(Number(held!.unrealized_plpc)).toBeCloseTo(Number(held!.unrealized_pl) / 100, 1)
    const fetched = await readJson<Order>(await call('GET', `/alpaca/v2/orders/${order.id}`))
    expect(fetched).toEqual(order)
    expect(await readJson<Order[]>(await call('GET', '/alpaca/v2/orders'))).toEqual([order])
  })

  it('accepts qty orders and reports qty instead of notional', async () => {
    const body = { ...buy('AAPL', '1'), notional: undefined, qty: '2' }
    const order = await readJson<Order>(await call('POST', '/alpaca/v2/orders', { body }))
    expect(order.qty).toBe('2')
    expect(order.notional).toBeNull()
    expect(order.asset_class).toBe('us_equity')
  })

  it('sells through a sell order', async () => {
    await call('POST', '/alpaca/v2/orders', {
      body: { ...buy('AAPL', '1'), notional: undefined, qty: '2' },
    })
    const sell = { symbol: 'AAPL', qty: '1', side: 'sell', type: 'market', time_in_force: 'ioc' }
    const order = await readJson<Order>(await call('POST', '/alpaca/v2/orders', { body: sell }))
    expect(order).toMatchObject({ side: 'sell', qty: '1', time_in_force: 'ioc', status: 'filled' })
    const positions = await readJson<{ qty: string }[]>(await call('GET', '/alpaca/v2/positions'))
    expect(positions.map((p) => p.qty)).toEqual(['1'])
  })

  it('rejects orders over the available cash with the real error body', async () => {
    const res = await call('POST', '/alpaca/v2/orders', { body: buy('AAPL', '5000') })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ code: 40310000, message: 'insufficient buying power' })
  })

  it('rejects selling more than held', async () => {
    const res = await call('POST', '/alpaca/v2/orders', {
      body: { symbol: 'AAPL', qty: '1', side: 'sell', type: 'market', time_in_force: 'day' },
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ code: 40410000, message: 'position does not exist' })
  })

  it('rejects malformed orders', async () => {
    const res = await call('POST', '/alpaca/v2/orders', { body: { symbol: 'AAPL' } })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      code: 40010001,
      message:
        'Invalid option: expected one of "buy"|"sell"; Invalid option: expected one of "market"|"limit"; Invalid option: expected one of "day"|"gtc"|"ioc"|"fok"|"opg"|"cls"',
    })
  })

  it('queues, reports and cancels limit orders', async () => {
    const body = {
      symbol: 'AAPL',
      qty: '1',
      side: 'buy',
      type: 'limit',
      time_in_force: 'gtc',
      limit_price: '90',
    }
    const res = await call('POST', '/alpaca/v2/orders', { body })
    expect(res.status).toBe(200)
    const order = await readJson<{
      id: string
      status: string
      limit_price: string
      type: string
      filled_qty: string
      filled_avg_price: null
    }>(res)
    expect(order).toMatchObject({
      status: 'new',
      limit_price: '90.00',
      type: 'limit',
      filled_qty: '0',
      filled_avg_price: null,
    })
    const cancelled = await call('DELETE', `/alpaca/v2/orders/${order.id}`)
    expect(cancelled.status).toBe(204)
    expect(await (await call('GET', `/alpaca/v2/orders/${order.id}`)).json()).toMatchObject({
      status: 'canceled',
    })
    const again = await call('DELETE', `/alpaca/v2/orders/${order.id}`)
    expect(again.status).toBe(422)
    expect(await again.json()).toEqual({ code: 40010001, message: 'order is not cancelable' })
    expect((await call('DELETE', '/alpaca/v2/orders/missing')).status).toBe(404)
  })

  it('lists and describes option contracts', async () => {
    const list = await call(
      'GET',
      '/alpaca/v2/options/contracts?underlying_symbols=AAPL&type=put&limit=2',
    )
    expect(list.status).toBe(200)
    const body = await readJson<{ option_contracts: { symbol: string; type: string }[] }>(list)
    expect(body.option_contracts).toHaveLength(2)
    expect(body.option_contracts[0]?.type).toBe('put')
    const one = await call(
      'GET',
      `/alpaca/v2/options/contracts/${body.option_contracts[0]?.symbol}`,
    )
    expect(await one.json()).toMatchObject({ underlying_symbol: 'AAPL', multiplier: '100' })
    expect((await call('GET', '/alpaca/v2/options/contracts/AAPL')).status).toBe(404)
    expect((await call('GET', '/alpaca/v2/options/contracts')).status).toBe(400)
    const bought = await call('POST', '/alpaca/v2/orders', {
      body: {
        symbol: body.option_contracts[0]?.symbol,
        qty: '1',
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      },
    })
    const order = await readJson<{ filled_avg_price: string }>(bought)
    expect(order).toMatchObject({ asset_class: 'us_option', status: 'filled' })
    const positions = await readJson<(Position & { market_value: string; cost_basis: string })[]>(
      await call('GET', '/alpaca/v2/positions'),
    )
    expect(positions[0]).toMatchObject({ asset_class: 'us_option', qty: '1' })
    expect(Number(positions[0]?.cost_basis)).toBeCloseTo(Number(order.filled_avg_price) * 100, 2)
    expect(Number(positions[0]?.market_value)).toBeGreaterThan(Number(order.filled_avg_price) * 90)
  })

  it('closes a whole position at market', async () => {
    await call('POST', '/alpaca/v2/orders', { body: buy('BTC/USD', '100.00') })
    const res = await call('DELETE', '/alpaca/v2/positions/BTCUSD')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ symbol: 'BTC/USD', side: 'sell', status: 'filled' })
    expect(await (await call('GET', '/alpaca/v2/positions')).json()).toEqual([])
    const again = await call('DELETE', '/alpaca/v2/positions/BTCUSD')
    expect(again.status).toBe(404)
    expect(await again.json()).toEqual({ code: 40410000, message: 'position does not exist' })
  })

  it('returns 404 for unknown orders and endpoints', async () => {
    const order = await call('GET', '/alpaca/v2/orders/missing')
    expect(order.status).toBe(404)
    expect(await order.json()).toEqual({ code: 40410000, message: 'order not found' })
    const endpoint = await call('GET', '/alpaca/v2/nothing')
    expect(endpoint.status).toBe(404)
    expect(await endpoint.json()).toEqual({ code: 40410000, message: 'endpoint not found' })
  })

  it('describes assets', async () => {
    const crypto = await (await call('GET', '/alpaca/v2/assets/BTC%2FUSD')).json()
    expect(crypto).toMatchObject({
      symbol: 'BTC/USD',
      class: 'crypto',
      tradable: true,
      fractionable: true,
      status: 'active',
    })
    const stock = await readJson<Asset>(await call('GET', '/alpaca/v2/assets/AAPL'))
    expect(stock).toMatchObject({
      symbol: 'AAPL',
      class: 'us_equity',
      exchange: 'NASDAQ',
      marginable: true,
    })
    expect(stock.id).toBe('58cd330b-0000-4000-8000-58cd330b58cd')
  })

  it('serves the clock from the current time and the override', async () => {
    expect(await (await call('GET', '/alpaca/v2/clock')).json()).toEqual({
      timestamp: '2026-09-01T15:00:00.000Z',
      is_open: true,
      next_open: '2026-09-02T13:30:00.000Z',
      next_close: '2026-09-01T20:00:00.000Z',
    })
    const closed = alpacaCall(setup({ marketOpen: false }).call)
    expect((await readJson<Clock>(await closed('GET', '/alpaca/v2/clock'))).is_open).toBe(false)
  })
})

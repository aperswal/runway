import { describe, expect, it } from 'vitest'
import { alpacaCall, readJson, setup } from './test-support.ts'

type State = {
  cash: number
  equity: number
  positions: Record<string, unknown>[]
  orders: Record<string, unknown>[]
  prices: Record<string, number>
  posts: unknown[]
}

describe('control api', () => {
  it('sets prices so stops and targets can be driven', async () => {
    const { call, deps } = setup()
    const res = await call('POST', '/_control/price', {
      body: { symbol: 'btcusd', price: 123.456 },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ symbol: 'BTC/USD', price: 123.456 })
    expect(deps.state.prices.snapshot()).toEqual({ 'BTC/USD': 123.46 })
    expect(Math.abs(deps.state.prices.current('BTC/USD') - 123.46)).toBeLessThan(1)
  })

  it('rejects bad prices with every validation issue', async () => {
    const { call } = setup()
    const bad = await call('POST', '/_control/price', { body: { symbol: '', price: -1 } })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({
      message:
        'symbol Too small: expected string to have >=1 characters; price Too small: expected number to be >=0.01',
    })
    const empty = await call('POST', '/_control/price')
    expect(empty.status).toBe(400)
    expect(await empty.json()).toEqual({
      message: ' Invalid input: expected object, received undefined',
    })
  })

  it('exposes state and resets everything', async () => {
    const { call, deps } = setup()
    const alpaca = alpacaCall(call)
    await call('POST', '/_control/price', { body: { symbol: 'AAPL', price: 100 } })
    await alpaca('POST', '/alpaca/v2/orders', {
      body: { symbol: 'AAPL', qty: '1', side: 'buy', type: 'market', time_in_force: 'day' },
    })
    deps.posts.add({ network: 'x', text: 'a', image: null, receivedAt: 't' })
    const state = await readJson<State>(await call('GET', '/_control/state'))
    expect(state.cash).toBeLessThan(1000)
    expect(state.equity).toBeGreaterThan(900)
    expect(state.positions).toEqual([
      expect.objectContaining({ symbol: 'AAPL', qty: '1', asset_class: 'us_equity' }),
    ])
    expect(state.orders).toEqual([expect.objectContaining({ symbol: 'AAPL', status: 'filled' })])
    expect(state.prices.AAPL).toBeGreaterThan(0)
    expect(state.posts).toEqual([{ network: 'x', text: 'a', image: null, receivedAt: 't' }])
    expect(await (await call('POST', '/_control/reset')).json()).toEqual({ ok: true })
    const fresh = await (await call('GET', '/_control/state')).json()
    expect(fresh).toEqual({
      cash: 1000,
      equity: 1000,
      positions: [],
      orders: [],
      prices: {},
      posts: [],
    })
    expect(await (await call('GET', '/_control/posts')).json()).toEqual([])
  })

  it('lists posts from both networks', async () => {
    const { call, deps } = setup()
    deps.posts.add({ network: 'x', text: 'a', image: null, receivedAt: 't' })
    deps.posts.add({ network: 'linkedin', text: 'b', image: null, receivedAt: 't' })
    expect(await (await call('GET', '/_control/posts')).json()).toEqual([
      { network: 'x', text: 'a', image: null, receivedAt: 't' },
      { network: 'linkedin', text: 'b', image: null, receivedAt: 't' },
    ])
  })

  it('returns 404 for unknown control endpoints', async () => {
    const { call } = setup()
    const res = await call('GET', '/_control/nothing')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ message: 'unknown control endpoint' })
  })
})

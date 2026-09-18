import { describe, expect, it } from 'vitest'
import { PREFIXES, createDeps, createHandler } from './router.ts'
import { BASE_CONFIG, buildRequest, setup } from './test-support.ts'

describe('router', () => {
  it('rejects unknown prefixes with the list of fakes', async () => {
    const { call } = setup()
    const res = await call('GET', '/v2/account')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      message: 'unknown mock prefix',
      prefixes: ['/alpaca', '/alpaca-data', '/x', '/linkedin', '/deepinfra', '/_control'],
    })
    expect(PREFIXES).toEqual([
      '/alpaca',
      '/alpaca-data',
      '/x',
      '/linkedin',
      '/deepinfra',
      '/_control',
    ])
    const near = await call('GET', '/alpacax/v2/account')
    expect(near.status).toBe(404)
    expect(await near.json()).toMatchObject({ message: 'unknown mock prefix' })
  })

  it('treats a bare prefix as its root path', async () => {
    const { call } = setup()
    const res = await call('GET', '/_control')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ message: 'unknown control endpoint' })
  })

  it('strips the prefix before routing', async () => {
    const { call } = setup()
    const res = await call('GET', '/_control/state')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ cash: 1000 })
  })

  it('rejects invalid json bodies', async () => {
    const { deps } = setup()
    const invalid = await createHandler(deps)(
      new Request('http://mocks/x/2/tweets', { method: 'POST', body: '{' }),
    )
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ message: 'invalid json body' })
  })

  it('rethrows unexpected errors', async () => {
    const { deps } = setup()
    deps.state.prices.current = () => {
      throw new TypeError('boom')
    }
    const request = buildRequest('GET', '/alpaca-data/v2/stocks/trades/latest?symbols=AAPL', {
      headers: { 'apca-api-key-id': 'k', 'apca-api-secret-key': 's' },
    })
    await expect(createHandler(deps)(request)).rejects.toThrow('boom')
  })

  it('defaults the clock to the real time', () => {
    const before = Date.now()
    const deps = createDeps(BASE_CONFIG)
    expect(deps.now().getTime()).toBeGreaterThanOrEqual(before)
    expect(deps.state.cash).toBe(1000)
    expect(deps.posts.list()).toEqual([])
  })
})

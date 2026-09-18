import { afterEach, describe, expect, it, vi } from 'vitest'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { DATA, DATA_TOKEN, headerOf, stubFetch, testEnv } from '../test/helpers'
import { app } from './app'
import { DATA_ROUTES } from './data'

const get = async (path: string, token: string | null = DATA_TOKEN): Promise<Response> => {
  const ctx = createExecutionContext()
  const res = await app.fetch(
    new Request(`http://site.test${path}`, {
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
    }),
    testEnv(),
    ctx,
  )
  await waitOnExecutionContext(ctx)
  return res
}

describe('data proxy', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('proxies known datasets with the query string and alpaca credentials', async () => {
    const { calls } = stubFetch([
      {
        url: `${DATA}/v2/stocks/bars?symbols=AAPL&timeframe=1Day`,
        status: 200,
        body: '{"bars":{}}',
      },
    ])
    const res = await get('/data/stock-bars?symbols=AAPL&timeframe=1Day')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe('{"bars":{}}')
    expect(headerOf(calls[0], 'APCA-API-KEY-ID')).toBe('test-key')
  })

  it('maps every dataset to its alpaca path', async () => {
    const paths: Record<string, string> = {
      'stock-bars': '/v2/stocks/bars',
      'crypto-bars': '/v1beta3/crypto/us/bars',
      'stock-snapshots': '/v2/stocks/snapshots',
      'crypto-snapshots': '/v1beta3/crypto/us/snapshots',
      'stock-movers': '/v1beta1/screener/stocks/movers',
      'crypto-movers': '/v1beta1/screener/crypto/movers',
      'most-actives': '/v1beta1/screener/stocks/most-actives',
      'option-bars': '/v1beta1/options/bars',
      'option-snapshots': '/v1beta1/options/snapshots',
      'option-trades': '/v1beta1/options/trades/latest',
      news: '/v1beta1/news',
    }
    expect([...Object.keys(paths), 'option-chain/<underlying>'].sort()).toEqual(
      [...DATA_ROUTES].sort(),
    )
    for (const [name, path] of Object.entries(paths)) {
      const { calls } = stubFetch([{ url: `${DATA}${path}?x=1`, body: '{}' }])
      expect((await get(`/data/${name}?x=1`)).status).toBe(200)
      expect(calls.map((c) => c.url)).toEqual([`${DATA}${path}?x=1`])
    }
  })

  it('proxies the option chain for an underlying', async () => {
    const { calls } = stubFetch([
      { url: `${DATA}/v1beta1/options/snapshots/AAPL?feed=indicative`, body: '{"snapshots":{}}' },
      { url: `${DATA}/v1beta1/options/snapshots/NOPE`, status: 404, body: '{}' },
    ])
    const res = await get('/data/option-chain/aapl?feed=indicative'.replace('aapl', 'AAPL'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"snapshots":{}}')
    expect(calls[0]?.url).toBe(`${DATA}/v1beta1/options/snapshots/AAPL?feed=indicative`)
    expect((await get('/data/option-chain/NOPE')).status).toBe(404)
  })

  it('sets json content type, caches only bar datasets, and never serves stale non-bar data', async () => {
    const { calls } = stubFetch([
      { url: `${DATA}/v1beta1/news?a=1`, body: '{"news":[]}' },
      { url: `${DATA}/v1beta3/crypto/us/bars?a=1`, body: '{"bars":{}}' },
    ])
    await caches.default.put(
      new Request('http://site.test/data/news?a=1', {
        headers: { authorization: `Bearer ${DATA_TOKEN}` },
      }),
      new Response('{"stale":true}', { headers: { 'cache-control': 'public, max-age=60' } }),
    )
    const news = await get('/data/news?a=1')
    expect(news.headers.get('content-type')).toBe('application/json')
    expect(news.headers.get('cache-control')).toBeNull()
    expect(await news.text()).toBe('{"news":[]}')
    await get('/data/news?a=1')
    expect(calls.filter((c) => c.url.includes('/news')).length).toBe(2)
    const bars = await get('/data/crypto-bars?a=1')
    expect(bars.headers.get('content-type')).toBe('application/json')
    expect(bars.headers.get('cache-control')).toBe('public, max-age=60')
    await get('/data/crypto-bars?a=1')
    expect(calls.filter((c) => c.url.includes('/bars')).length).toBe(1)
  })

  it('passes upstream failures through', async () => {
    stubFetch([{ url: `${DATA}/v1beta1/news`, status: 429, body: '{"message":"slow down"}' }])
    const res = await get('/data/news')
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ message: 'slow down' })
  })

  it('lists datasets for unknown names', async () => {
    const res = await get('/data/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'unknown_dataset', datasets: DATA_ROUTES })
    expect(DATA_ROUTES).toContain('crypto-movers')
  })

  it('requires the data token', async () => {
    expect((await get('/data/news', null)).status).toBe(401)
    expect((await get('/data/news', 'wrong')).status).toBe(401)
  })

  it('caches bar responses at the edge and serves hits without another alpaca call', async () => {
    const { calls } = stubFetch([
      { url: `${DATA}/v2/stocks/bars?symbols=AAPL`, body: '{"bars":{"AAPL":[]}}', times: 1 },
    ])
    const first = await get('/data/stock-bars?symbols=AAPL')
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('public, max-age=60')
    expect(await first.text()).toBe('{"bars":{"AAPL":[]}}')
    const second = await get('/data/stock-bars?symbols=AAPL')
    expect(second.status).toBe(200)
    expect(await second.text()).toBe('{"bars":{"AAPL":[]}}')
    expect(calls).toHaveLength(1)
  })

  it('does not cache non-bar datasets', async () => {
    const { calls } = stubFetch([
      { url: `${DATA}/v2/stocks/snapshots?symbols=AAPL`, body: '{}', times: 2 },
    ])
    await get('/data/stock-snapshots?symbols=AAPL')
    await get('/data/stock-snapshots?symbols=AAPL')
    expect(calls).toHaveLength(2)
  })

  it('does not cache failed bar responses', async () => {
    const { calls } = stubFetch([
      { url: `${DATA}/v2/stocks/bars?symbols=FAIL`, status: 500, body: '{"message":"down"}' },
    ])
    const res = await get('/data/stock-bars?symbols=FAIL')
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBeNull()
    const retry = await get('/data/stock-bars?symbols=FAIL')
    expect(retry.status).toBe(500)
    expect(calls).toHaveLength(2)
  })
})

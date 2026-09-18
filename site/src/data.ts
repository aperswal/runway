import { Hono } from 'hono'
import type { Deps } from './deps'

const UPSTREAM: Record<string, string> = {
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
const OPTION_CHAIN = '/v1beta1/options/snapshots/'

export const DATA_ROUTES = [...Object.keys(UPSTREAM), 'option-chain/<underlying>']
const HTTP_NOT_FOUND = 404
const BAR_CACHE_CONTROL = 'public, max-age=60'
const isCacheable = (name: string): boolean => name === 'stock-bars' || name === 'crypto-bars'

export const data = new Hono<{ Variables: { deps: Deps } }>()

data.get('/option-chain/:underlying', async (c) => {
  const path = `${OPTION_CHAIN}${encodeURIComponent(c.req.param('underlying'))}`
  const res = await c.var.deps.alpaca.proxyData(path + new URL(c.req.url).search)
  return new Response(res.body, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  })
})

data.get('/:name', async (c) => {
  const name = c.req.param('name')
  const upstream = UPSTREAM[name]
  if (upstream === undefined) {
    return c.json({ error: 'unknown_dataset', datasets: DATA_ROUTES }, HTTP_NOT_FOUND)
  }
  const cache = caches.default
  const cacheable = isCacheable(name)
  if (cacheable) {
    const hit = await cache.match(c.req.raw)
    if (hit !== undefined) {
      return hit
    }
  }
  const query = new URL(c.req.url).search
  const res = await c.var.deps.alpaca.proxyData(upstream + query)
  const shouldCache = cacheable && res.ok
  const headers = shouldCache
    ? { 'content-type': 'application/json', 'cache-control': BAR_CACHE_CONTROL }
    : { 'content-type': 'application/json' }
  const response = new Response(res.body, { status: res.status, headers })
  if (shouldCache) {
    c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()))
  }
  return response
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  INTERNAL_TOKEN,
  accountJson,
  insertSnapshot,
  insertTrade,
  seedFund,
  resetDb,
  stubFetch,
  testEnv,
} from '../test/helpers'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { app, internalSecrets } from './app'
import { buildDeps } from './deps'

const fetchWith = async (path: string, init: RequestInit, env: ReturnType<typeof testEnv>) => {
  const ctx = createExecutionContext()
  const res = await app.fetch(new Request(`http://site.test${path}`, init), env, ctx)
  await waitOnExecutionContext(ctx)
  return res
}

const request = (path: string, init: RequestInit = {}, env = testEnv()): Promise<Response> => {
  const headers = new Headers(init.headers)
  headers.set('cache-control', 'no-cache')
  return fetchWith(path, { ...init, headers }, env)
}

const auth = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` })

describe('research pages', () => {
  it('serve the notes and stats pages', async () => {
    const notes = await request('/notes?kind=observations&page=2')
    expect(notes.status).toBe(200)
    expect(notes.headers.get('cache-control')).toBe('public, max-age=60')
    expect(await notes.text()).toContain(
      '<h1>Notes</h1><div class="sub">0 observations, newest first</div>',
    )
    const stats = await request('/stats?kind=backtest')
    expect(stats.status).toBe(200)
    expect(stats.headers.get('cache-control')).toBe('public, max-age=60')
    expect(await stats.text()).toContain('<title>Runway stats</title>')
  })
})

describe('static routes', () => {
  const PNG = [137, 80, 78, 71]
  const signature = async (res: Response) => [
    ...new Uint8Array(await res.arrayBuffer()).slice(0, 4),
  ]

  it('serves the icons, manifest, robots and sitemap', async () => {
    const svg = await request('/icon.svg')
    expect(svg.headers.get('content-type')).toBe('image/svg+xml')
    expect(svg.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(await svg.text()).toContain('<polyline points="12,44 22,38 30,41 40,28 52,18"')
    for (const path of ['/favicon.ico', '/favicon.png', '/apple-touch-icon.png', '/icon-512.png']) {
      const res = await request(path)
      expect(res.headers.get('content-type')).toBe('image/png')
      expect(await signature(res)).toEqual(PNG)
    }
    const manifest = await request('/manifest.webmanifest')
    expect(manifest.headers.get('content-type')).toBe('application/manifest+json')
    expect(await manifest.json()).toMatchObject({ name: 'Runway', theme_color: '#0f1110' })
    const robots = await request('/robots.txt')
    expect(await robots.text()).toBe(
      'User-agent: *\nAllow: /\nDisallow: /internal/\nDisallow: /data/\nSitemap: http://site.test/sitemap.xml\n',
    )
    const sitemap = await request('/sitemap.xml')
    expect(sitemap.headers.get('content-type')).toBe('application/xml')
    expect(await sitemap.text()).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>http://site.test/</loc></url><url><loc>http://site.test/notes</loc></url><url><loc>http://site.test/stats</loc></url></urlset>',
    )
  })

  it('renders the live chart as the share image', async () => {
    await resetDb()
    const res = await request('/og.png')
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('public, max-age=600')
    expect(await signature(res)).toEqual(PNG)
  })
})

describe('research token', () => {
  const scoped = testEnv({ RESEARCH_TOKEN: 'research-token-0123456789' })
  it('opens research and order routes but not fund, context or run routes', async () => {
    const research = auth('research-token-0123456789')
    expect((await request('/internal/notes', { headers: research }, scoped)).status).toBe(200)
    expect((await request('/internal/trades', { headers: research }, scoped)).status).toBe(200)
    expect(
      (await request('/internal/jobs?fund=social', { headers: research }, scoped)).status,
    ).toBe(200)
    expect((await request('/internal/funds', { headers: research }, scoped)).status).toBe(401)
    expect((await request('/internal/context', { headers: research }, scoped)).status).toBe(401)
    expect((await request('/internal/notes', { headers: research })).status).toBe(401)
    expect(internalSecrets(buildDeps(scoped), '/internal/notes')).toHaveLength(2)
    expect(internalSecrets(buildDeps(scoped), '/internal/positions')).toHaveLength(2)
    expect(internalSecrets(buildDeps(scoped), '/internal/orders/AAPL')).toHaveLength(2)
    expect(internalSecrets(buildDeps(scoped), '/internal/funds')).toHaveLength(1)
    expect(internalSecrets(buildDeps(scoped), '/internal/runs')).toHaveLength(1)
  })
})

describe('public routes', () => {
  beforeEach(async () => {
    await resetDb()
    await insertSnapshot({ takenAt: '2026-09-01T12:00:00.000Z', equity: 1000 })
    await insertSnapshot({ takenAt: new Date().toISOString(), equity: 1090 })
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson({ equity: '1100' }) },
      { url: `${ALPACA}/v2/positions`, body: [] },
    ])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('serves the page with the default horizon and closed page', async () => {
    const res = await request('/?closed=abc')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    const html = await res.text()
    expect(html).toContain('<a href="/?h=1M" data-h="1M" class="active">')
    expect(html).toContain('$1,100.00')
  })

  it('accepts a horizon query and ignores unknown ones', async () => {
    expect(await (await request('/?h=1W')).text()).toContain(
      '<a href="/?h=1W" data-h="1W" class="active">',
    )
    expect(await (await request('/?h=9Y')).text()).toContain(
      '<a href="/?h=1M" data-h="1M" class="active">',
    )
    expect((await request('/?closed=2')).status).toBe(200)
    await seedFund()
    for (let i = 0; i < 11; i += 1) {
      await insertTrade({ symbol: `S${i}`, status: 'closed', closedAt: new Date().toISOString() })
    }
    const paged: { closedPage: { page: number } } = await (
      await request('/api/summary?closed=2')
    ).json()
    expect(paged.closedPage.page).toBe(2)
  })

  it('serves public pages from the edge cache for a minute unless bypassed', async () => {
    const first = await fetchWith('/api/summary?h=1W', {}, testEnv())
    expect(first.status).toBe(200)
    const before: { equity: number } = await first.json()
    expect(before.equity).toBe(1100)
    vi.unstubAllGlobals()
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson({ equity: '1250' }) },
      { url: `${ALPACA}/v2/positions`, body: [] },
    ])
    const cached: { equity: number } = await (
      await fetchWith('/api/summary?h=1W', {}, testEnv())
    ).json()
    expect(cached.equity).toBe(1100)
    const fresh: { equity: number } = await (await request('/api/summary?h=1W')).json()
    expect(fresh.equity).toBe(1250)
    const missing = await fetchWith('/nope', {}, testEnv())
    expect(missing.status).toBe(404)
    expect((await fetchWith('/nope', {}, testEnv())).status).toBe(404)
    expect(await caches.default.match(new Request('http://site.test/nope'))).toBeUndefined()
    const posted = await fetchWith('/api/summary?h=1W', { method: 'POST' }, testEnv())
    expect(posted.status).toBe(404)
    const internal = await fetchWith(
      '/internal/funds',
      { headers: auth(INTERNAL_TOKEN) },
      testEnv(),
    )
    expect(internal.status).toBe(200)
    await seedFund({ id: 'later', name: 'Later' })
    const rows: { id: string }[] = await (
      await fetchWith('/internal/funds', { headers: auth(INTERNAL_TOKEN) }, testEnv())
    ).json()
    expect(rows.map((f) => f.id)).toContain('later')
  })

  it('hands /live to the ticker object without caching', async () => {
    const res = await fetchWith('/live', {}, testEnv())
    expect(res.status).toBe(426)
    expect(await caches.default.match(new Request('http://site.test/live'))).toBeUndefined()
  })

  it('does not cache failed responses', async () => {
    vi.unstubAllGlobals()
    stubFetch([])
    const env = testEnv({ INTERNAL_TOKEN: 'short' })
    expect((await fetchWith('/api/summary?h=3M', {}, env)).status).toBe(500)
    expect((await fetchWith('/api/summary?h=3M', {}, testEnv())).status).toBe(200)
  })

  it('serves the summary as json', async () => {
    const res = await request('/api/summary?h=ALL')
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=60')
    const body: { horizon: string; equity: number } = await res.json()
    expect(body.horizon).toBe('ALL')
    expect(body.equity).toBe(1100)
  })
})

describe('bearer auth', () => {
  it('rejects missing, malformed and wrong tokens', async () => {
    expect((await request('/internal/funds')).status).toBe(401)
    expect(
      (await request('/internal/funds', { headers: { authorization: 'Basic abc' } })).status,
    ).toBe(401)
    expect((await request('/internal/funds', { headers: auth('nope') })).status).toBe(401)
    expect(await (await request('/internal/funds', { headers: auth('nope') })).text()).toBe(
      'unauthorized',
    )
  })

  it('rejects the right token under another scheme', async () => {
    const res = await request('/internal/funds', {
      headers: { authorization: `Digest ${INTERNAL_TOKEN}` },
    })
    expect(res.status).toBe(401)
  })

  it('accepts the internal token', async () => {
    expect((await request('/internal/funds', { headers: auth(INTERNAL_TOKEN) })).status).toBe(200)
  })
})

describe('error mapping', () => {
  beforeEach(resetDb)
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const post = (path: string, body: string): Promise<Response> =>
    request(path, {
      method: 'POST',
      body,
      headers: { ...auth(INTERNAL_TOKEN), 'content-type': 'application/json' },
    })

  it('returns 400 with issues for invalid input', async () => {
    const res = await post('/internal/positions', JSON.stringify({ fund: 'social' }))
    expect(res.status).toBe(400)
    const body: { error: string; issues: { path: string[] }[] } = await res.json()
    expect(body.error).toBe('invalid_input')
    expect(body.issues.length).toBeGreaterThan(0)
  })

  it('returns 422 for guardrails', async () => {
    const res = await post(
      '/internal/funds',
      JSON.stringify({ id: 'x', name: 'X', mandate: 'a mandate that is long enough', share: 2 }),
    )
    expect(res.status).toBe(400)
    const guard = await post(
      '/internal/analyses',
      JSON.stringify({ fund: 'nope', kind: 'technical', title: 'n', body: 'b' }),
    )
    expect(guard.status).toBe(422)
    expect(await guard.json()).toEqual({
      error: 'unknown_fund',
      message: 'unknown_fund: no fund nope',
    })
  })

  it('returns 422 for state errors', async () => {
    const res = await request('/internal/positions/AAPL', {
      method: 'DELETE',
      body: JSON.stringify({ reason: 'done' }),
      headers: auth(INTERNAL_TOKEN),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'state', message: 'no open position in AAPL' })
  })

  it('returns 502 for upstream failures', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubFetch([
      { url: `${ALPACA}/v2/account`, status: 500, body: 'down' },
      { url: `${ALPACA}/v2/clock`, status: 500, body: 'down' },
    ])
    const res = await request('/internal/context', { headers: auth(INTERNAL_TOKEN) })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({
      error: 'upstream',
      message: 'alpaca 500: /v2/account: down',
    })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"path":"/internal/context"'))
  })

  it('returns 500 config when the environment is broken', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await request('/api/summary', {}, testEnv({ INTERNAL_TOKEN: 'short' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'config' })
  })

  it('returns 500 internal for unexpected errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const res = await post('/internal/runs', 'not json')
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'internal' })
  })
})

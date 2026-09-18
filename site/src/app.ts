import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { data } from './data'
import { buildDeps, safeEqual, type Deps } from './deps'
import type { Bindings } from './env'
import { ConfigError, ExternalServiceError, InputError, StateError } from './errors'
import { GuardrailError } from './guardrails'
import { HORIZONS, type Horizon } from './horizons'
import { internal } from './internal'
import { internalResearch } from './internal-research'
import { errorMessage, log } from './log'
import { PAGE_PATH, renderPage } from './page'
import { notesPage, statsPage } from './research-pages'
import { statics } from './static-routes'
import { buildSummary, type SummaryQuery } from './summary'

type Env = { Bindings: Bindings; Variables: { deps: Deps } }

const HTTP = {
  badRequest: 400,
  unauthorized: 401,
  unprocessable: 422,
  internal: 500,
  upstream: 502,
} as const
const CACHE = 'public, max-age=60'
const BEARER = 'Bearer '

const horizonFrom = (raw: string | undefined): Horizon => HORIZONS.find((h) => h === raw) ?? '1M'

const isAuthorized = (header: string | undefined, secret: string): boolean =>
  header !== undefined &&
  header.startsWith(BEARER) &&
  safeEqual(header.slice(BEARER.length), secret)

const bearer =
  (pick: (deps: Deps, path: string) => string[]): MiddlewareHandler<Env> =>
  async (c, next) => {
    const header = c.req.header('authorization')
    if (!pick(c.var.deps, c.req.path).some((secret) => isAuthorized(header, secret))) {
      return c.text('unauthorized', HTTP.unauthorized)
    }
    await next()
    return undefined
  }

const MANAGER_SCOPE = [
  '/internal/analyses',
  '/internal/notes',
  '/internal/observations',
  '/internal/lessons',
  '/internal/monitors',
  '/internal/jobs',
  '/internal/trades',
  '/internal/options/contracts',
  '/internal/positions',
  '/internal/orders',
]

const inManagerScope = (path: string): boolean =>
  MANAGER_SCOPE.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))

export const internalSecrets = (deps: Deps, path: string): string[] => {
  const manager = deps.config.RESEARCH_TOKEN
  return manager !== undefined && inManagerScope(path)
    ? [deps.config.INTERNAL_TOKEN, manager]
    : [deps.config.INTERNAL_TOKEN]
}

export const app = new Hono<Env>()

app.use('*', async (c, next) => {
  c.set('deps', buildDeps(c.env))
  await next()
})

const PRIVATE_PREFIXES = ['/internal/', '/data/', '/live']

const cacheable = (req: {
  method: string
  path: string
  header: (name: string) => string | undefined
}): boolean => {
  const bypass = req.header('cache-control')?.includes('no-cache') ?? false
  const isPrivate = PRIVATE_PREFIXES.some((prefix) => req.path.startsWith(prefix))
  return req.method === 'GET' && !bypass && !isPrivate
}

const pageParam = z.coerce.number().int().positive().catch(1)
const summaryQuery = (query: (key: string) => string | undefined): SummaryQuery => ({
  horizon: horizonFrom(query('h')),
  closedPage: pageParam.parse(query('closed')),
  now: new Date(),
})

app.use('*', async (c, next) => {
  if (!cacheable(c.req)) {
    await next()
    return undefined
  }
  const cache = caches.default
  const hit = await cache.match(c.req.raw)
  if (hit !== undefined) {
    return hit
  }
  await next()
  if (c.res.ok) {
    c.executionCtx.waitUntil(cache.put(c.req.raw, c.res.clone()))
  }
  return undefined
})

app.get('/live', (c) => c.env.TICKER.getByName('ticker').fetch(c.req.raw))
app.route('/', statics)

const pageUrl = (siteUrl: string, requestUrl: string): string => {
  const requested = new URL(requestUrl)
  return `${new URL(siteUrl).origin}${requested.pathname}${requested.search}`
}

app.get(PAGE_PATH, async (c) => {
  const { db, alpaca, summary, config } = c.var.deps
  const page = renderPage(
    await buildSummary(
      db,
      alpaca,
      summary,
      summaryQuery((key) => c.req.query(key)),
    ),
    pageUrl(config.SITE_URL, c.req.url),
  )
  return c.html(page, undefined, { 'cache-control': CACHE })
})

app.get('/notes', async (c) =>
  c.html(
    await notesPage(c.var.deps.db, c.req.query(), pageUrl(c.var.deps.config.SITE_URL, c.req.url)),
    undefined,
    { 'cache-control': CACHE },
  ),
)

app.get('/stats', async (c) =>
  c.html(
    await statsPage(
      c.var.deps.db,
      c.req.query(),
      new Date(),
      pageUrl(c.var.deps.config.SITE_URL, c.req.url),
    ),
    undefined,
    { 'cache-control': CACHE },
  ),
)

app.get('/api/summary', async (c) => {
  const { db, alpaca, summary } = c.var.deps
  const body = await buildSummary(
    db,
    alpaca,
    summary,
    summaryQuery((key) => c.req.query(key)),
  )
  return c.json(body, undefined, { 'cache-control': CACHE })
})

app.use('/internal/*', bearer(internalSecrets))
app.route('/internal', internal)
app.route('/internal', internalResearch)

app.use(
  '/data/*',
  bearer((d) => [d.config.DATA_TOKEN]),
)
app.route('/data', data)

app.onError((error, c) => {
  if (error instanceof InputError) {
    return c.json({ error: 'invalid_input', issues: error.issues }, HTTP.badRequest)
  }
  if (error instanceof GuardrailError) {
    return c.json({ error: error.code, message: error.message }, HTTP.unprocessable)
  }
  if (error instanceof StateError) {
    return c.json({ error: 'state', message: error.message }, HTTP.unprocessable)
  }
  log.error({ path: c.req.path, message: errorMessage(error), stack: error.stack })
  if (error instanceof ExternalServiceError) {
    return c.json({ error: 'upstream', message: error.message }, HTTP.upstream)
  }
  const kind = error instanceof ConfigError ? 'config' : 'internal'
  return c.json({ error: kind, message: error.message }, HTTP.internal)
})

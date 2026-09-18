import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  DATA,
  INTERNAL_TOKEN,
  accountJson,
  assetJson,
  clockJson,
  db,
  fakeQueue,
  headlineJson,
  insertTrade,
  latestTradesJson,
  orderJson,
  resetDb,
  seedFund,
  stubFetch,
  testEnv,
  fakeAgent,
} from '../test/helpers'
import { eq } from 'drizzle-orm'
import { app } from './app'
import { runs, trades } from './db/schema'

const queue = fakeQueue()
const env = testEnv({ POSTS: queue.queue })

const call = (method: string, path: string, body?: unknown): Promise<Response> =>
  Promise.resolve(
    app.fetch(
      new Request(`http://site.test/internal${path}`, {
        method,
        headers: { authorization: `Bearer ${INTERNAL_TOKEN}`, 'content-type': 'application/json' },
        body: body === undefined ? null : JSON.stringify(body),
      }),
      env,
    ),
  )

const json = (res: Response): Promise<Record<string, unknown>> => res.json()

describe('internal routes', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
    queue.send.mockClear()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('closes a fraction of a position', async () => {
    await resetDb()
    await seedFund()
    const trade = await insertTrade({ qty: 0.5, notional: 100 })
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson() },
      { url: `${ALPACA}/v2/clock`, body: clockJson(true) },
      {
        url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`,
        body: latestTradesJson({ AAPL: 210 }),
      },
      {
        url: `${ALPACA}/v2/orders`,
        method: 'POST',
        body: orderJson({ id: 'sell-1', status: 'accepted', filledAvgPrice: null }),
      },
      {
        url: `${ALPACA}/v2/orders/sell-1`,
        body: orderJson({ id: 'sell-1', filledAvgPrice: '210' }),
      },
    ])
    const res = await call('DELETE', '/positions/AAPL', { reason: 'half off', fraction: 0.5 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'closed', qty: 0.25 })
    const [rest] = await db.select().from(trades).where(eq(trades.id, trade.id))
    expect(rest).toMatchObject({ status: 'open', qty: 0.25 })
  })

  it('runs a manager in its own container through the site', async () => {
    const { agent, fetch: containerFetch, idFromName } = fakeAgent([{ status: 202, body: '' }])
    await resetDb()
    const res = await app.fetch(
      new Request('http://site.test/internal/managers/quant/run', {
        method: 'POST',
        headers: { authorization: `Bearer ${INTERNAL_TOKEN}`, 'content-type': 'application/json' },
        body: '{"trigger":"0 6 * * *"}',
      }),
      testEnv({ AGENT: agent }),
    )
    expect(res.status).toBe(202)
    const { key } = await res.json<{ key: string }>()
    expect(idFromName).toHaveBeenCalledWith('manager-quant')
    expect(await containerFetch.mock.calls[0]![0].json()).toEqual({
      fund: 'quant',
      trigger: '0 6 * * *',
      key,
    })
    const pending = await call('GET', `/managers/quant/report?key=${key}`)
    expect(await pending.json()).toEqual({ done: false, outcome: null })
    const reported = await app.fetch(
      new Request('http://site.test/internal/managers/quant/report', {
        method: 'POST',
        headers: { authorization: `Bearer ${INTERNAL_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ key, outcome: { result: null, error: 'x', seen: [] } }),
      }),
      testEnv({ AGENT: agent }),
    )
    expect(reported.status).toBe(200)
    const done = await call('GET', `/managers/quant/report?key=${key}`)
    expect(await done.json()).toEqual({
      done: true,
      outcome: { result: null, error: 'x', seen: [] },
    })
    expect((await call('GET', '/managers/quant/report')).status).toBe(422)
    expect((await call('POST', '/managers/quant/run', {})).status).toBe(400)
  })

  it('stores the Codex login, hands it to each manager and refreshes it on demand', async () => {
    await resetDb()
    const auth = {
      tokens: { id_token: 'i', access_token: 'a', refresh_token: 'r' },
      last_refresh: '2026-09-10T00:00:00.000Z',
    }
    expect(await json(await call('GET', '/codex-auth'))).toEqual({
      configured: false,
      refreshedAt: null,
      accessTokenExpiresAt: null,
    })
    const stored = await call('POST', '/codex-auth', auth)
    expect(stored.status).toBe(201)
    expect(await json(stored)).toMatchObject({
      configured: true,
      refreshedAt: '2026-09-10T00:00:00.000Z',
    })
    expect((await call('POST', '/codex-auth', { tokens: {} })).status).toBe(400)
    const { agent, fetch: containerFetch } = fakeAgent([{ status: 202, body: '' }])
    await app.fetch(
      new Request('http://site.test/internal/managers/quant/run', {
        method: 'POST',
        headers: { authorization: `Bearer ${INTERNAL_TOKEN}`, 'content-type': 'application/json' },
        body: '{"trigger":"manual"}',
      }),
      testEnv({ AGENT: agent }),
    )
    expect(await containerFetch.mock.calls[0]![0].json()).toMatchObject({
      codexAuth: JSON.stringify(auth),
    })
    stubFetch([
      {
        url: 'https://auth.openai.com/oauth/token',
        method: 'POST',
        body: { access_token: 'a2', refresh_token: 'r2' },
      },
    ])
    const refreshed = await call('POST', '/codex-auth/refresh')
    expect(refreshed.status).toBe(200)
    expect((await json(refreshed)).refreshedAt).not.toBe('2026-09-10T00:00:00.000Z')
    stubFetch([
      { url: 'https://auth.openai.com/oauth/token', method: 'POST', status: 401, body: 'dead' },
    ])
    expect((await call('POST', '/codex-auth/refresh')).status).toBe(502)
  })

  it('lists trade history with filters', async () => {
    await resetDb()
    await seedFund()
    await insertTrade({ status: 'closed', exitReason: 'target' })
    await insertTrade({ symbol: 'MSFT' })
    const all = await call('GET', '/trades')
    expect(all.status).toBe(200)
    expect(await all.json()).toHaveLength(2)
    const closed = await call('GET', '/trades?status=closed&fund=social&limit=1')
    expect(await closed.json()).toHaveLength(1)
    expect((await call('GET', '/trades?status=nope')).status).toBe(400)
  })

  it('serves the agent context as text', async () => {
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson() },
      { url: `${ALPACA}/v2/positions`, body: [] },
      { url: `${ALPACA}/v2/clock`, body: clockJson() },
      { url: `${DATA}/v1beta1/news?limit=10`, body: { news: [headlineJson()] } },
    ])
    const research = await call('GET', '/context?trigger=0%206%20*%20*%20*')
    expect(await research.text()).toContain('This is a research run.')
    const scoped = await call('GET', '/context?trigger=manual&fund=nobody')
    expect(await scoped.text()).not.toContain('### social')
    const res = await call('GET', '/context')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    expect(await res.text()).toContain('## Money')
  })

  it('opens a position', async () => {
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson() },
      { url: `${ALPACA}/v2/clock`, body: clockJson(true) },
      { url: `${ALPACA}/v2/assets/AAPL`, body: assetJson() },
      {
        url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`,
        body: latestTradesJson({ AAPL: 200 }),
      },
      { url: `${ALPACA}/v2/orders`, method: 'POST', body: orderJson({ status: 'accepted' }) },
      { url: `${ALPACA}/v2/orders/ord-1`, body: orderJson() },
    ])
    const res = await call('POST', '/positions', {
      fund: 'social',
      symbol: 'aapl',
      notional: 100,
      stop: 180,
      target: 240,
      horizon: '2 weeks',
      reason: 'reviews',
    })
    expect(res.status).toBe(201)
    expect(await json(res)).toMatchObject({ symbol: 'AAPL', status: 'open', qty: 0.5 })
    expect(queue.send).toHaveBeenCalledTimes(1)
  })

  it('queues and cancels a limit order by encoded symbol', async () => {
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson() },
      { url: `${ALPACA}/v2/clock`, body: clockJson(false) },
      { url: `${ALPACA}/v2/assets/AAPL`, body: assetJson() },
      {
        url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`,
        body: latestTradesJson({ AAPL: 200 }),
      },
      { url: `${ALPACA}/v2/orders`, method: 'POST', body: orderJson({ status: 'new' }) },
      { url: `${ALPACA}/v2/orders/ord-1`, body: orderJson({ status: 'new' }) },
      { url: `${ALPACA}/v2/orders/ord-1`, method: 'DELETE', status: 204, body: '' },
    ])
    const res = await call('POST', '/positions', {
      fund: 'social',
      symbol: 'aapl',
      qty: 1,
      limit: 190,
      stop: 180,
      target: 240,
      horizon: '2 weeks',
      reason: 'reviews',
    })
    expect(res.status).toBe(201)
    expect(await json(res)).toMatchObject({ symbol: 'AAPL', status: 'pending', limitPrice: 190 })
    expect(queue.send).not.toHaveBeenCalled()
    expect((await call('DELETE', '/orders/msft', { reason: 'x' })).status).toBe(422)
    const cancelled = await call('DELETE', '/orders/aapl', { reason: 'changed mind' })
    expect(cancelled.status).toBe(200)
    expect(await json(cancelled)).toMatchObject({ status: 'cancelled', exitReason: 'changed mind' })
    expect((await call('DELETE', '/orders/aapl', {})).status).toBe(400)
  })

  it('closes a position by encoded symbol', async () => {
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson() },
      { url: `${ALPACA}/v2/clock`, body: clockJson(true) },
      {
        url: `${DATA}/v1beta3/crypto/us/latest/trades?symbols=BTC%2FUSD`,
        body: latestTradesJson({ 'BTC/USD': 250 }),
      },
      {
        url: `${ALPACA}/v2/positions/BTCUSD`,
        method: 'DELETE',
        body: orderJson({ id: 'c1', symbol: 'BTCUSD', status: 'accepted' }),
      },
      {
        url: `${ALPACA}/v2/orders/c1`,
        body: orderJson({ id: 'c1', symbol: 'BTCUSD', filledAvgPrice: '250' }),
      },
    ])
    await insertTrade({ symbol: 'BTC/USD', assetClass: 'crypto' })
    const res = await call('DELETE', '/positions/btc%2Fusd', { reason: 'thesis broke' })
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({
      status: 'closed',
      exitPrice: 250,
      exitReason: 'thesis broke',
    })
  })

  it('proxies option contract searches', async () => {
    stubFetch([
      {
        url: `${ALPACA}/v2/options/contracts?underlying_symbols=AAPL&type=call`,
        body: '{"option_contracts":[{"symbol":"AAPL260116C00190000"}]}',
      },
    ])
    const res = await call('GET', '/options/contracts?underlying_symbols=AAPL&type=call')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.text()).toBe('{"option_contracts":[{"symbol":"AAPL260116C00190000"}]}')
  })

  it('adjusts exits', async () => {
    stubFetch([
      {
        url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`,
        body: latestTradesJson({ AAPL: 210 }),
      },
    ])
    await insertTrade()
    const res = await call('PATCH', '/positions/aapl', { stop: 195 })
    expect(res.status).toBe(200)
    expect(await json(res)).toMatchObject({ stop: 195, target: 240 })
  })

  it('records runs', async () => {
    const run = {
      trigger: 'cron',
      startedAt: '2026-09-01T12:00:00Z',
      finishedAt: '2026-09-01T12:05:00Z',
      model: 'claude',
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.5,
      turns: 3,
      summary: 'Did nothing',
      error: null,
    }
    const res = await call('POST', '/runs', run)
    expect(res.status).toBe(201)
    expect(await json(res)).toMatchObject({ ...run, id: expect.any(Number) })
    expect(await db.select().from(runs)).toHaveLength(1)
  })

  it('lists, creates, reallocates and retires funds', async () => {
    stubFetch([{ url: `${ALPACA}/v2/account`, body: accountJson() }])
    const list = await call('GET', '/funds')
    expect(list.status).toBe(200)
    const rows: { id: string }[] = await list.json()
    expect(rows.map((f) => f.id)).toEqual(['social'])

    const created = await call('POST', '/funds', {
      id: 'supply',
      name: 'Supply chain',
      mandate: 'Hunt for bottlenecks and trade the beneficiaries.',
      share: 0.25,
    })
    expect(created.status).toBe(201)
    expect(await json(created)).toMatchObject({
      id: 'supply',
      share: 0.25,
      capital: 250,
      highWater: 250,
    })

    const moved = await call('PATCH', '/funds/supply', { share: 0.5 })
    expect(moved.status).toBe(200)
    expect(await json(moved)).toMatchObject({ share: 0.5, capital: 500, highWater: 500 })

    const retired = await call('DELETE', '/funds/supply', { reason: 'no edge' })
    expect(retired.status).toBe(200)
    expect(await json(retired)).toMatchObject({ status: 'retired', retireReason: 'no edge' })
  })

  it('creates, lists and cancels jobs', async () => {
    const created = await call('POST', '/jobs', {
      fund: 'social',
      name: 'funding',
      script: 'echo hi',
      everyMinutes: 60,
      runs: 2,
    })
    expect(created.status).toBe(201)
    const job = await json(created)
    const id = Number(job.id)
    expect(job).toMatchObject({ name: 'funding', status: 'active', timeoutSeconds: 300 })
    const list = await call('GET', '/jobs?fund=social')
    const listed: { id: number }[] = await list.json()
    expect(listed.map((j) => j.id)).toEqual([id])
    expect(await (await call('GET', '/jobs?fund=other')).json()).toEqual([])
    const cancelled = await call('DELETE', `/jobs/${id}`)
    expect(await json(cancelled)).toMatchObject({ status: 'cancelled' })
    expect((await call('DELETE', `/jobs/${id}`)).status).toBe(422)
    expect((await call('DELETE', '/jobs/abc')).status).toBe(400)
    expect((await call('POST', '/jobs', { fund: 'social', name: 'x' })).status).toBe(400)
  })

  it('records and lists notes', async () => {
    const created = await call('POST', '/notes', {
      fund: 'social',
      title: 'Thesis',
      body: 'Watch AAPL',
    })
    expect(created.status).toBe(201)
    expect(await json(created)).toMatchObject({ fund: 'social', title: 'Thesis' })
    const list = await call('GET', '/notes?fund=social')
    const rows: { title: string }[] = await list.json()
    expect(rows.map((n) => n.title)).toEqual(['Thesis'])
    expect(await (await call('GET', '/notes?fund=other')).json()).toEqual([])
    expect((await call('POST', '/notes', { fund: 'social', title: '' })).status).toBe(400)
  })

  it('records and lists observations', async () => {
    const created = await call('POST', '/observations', {
      fund: 'social',
      symbol: 'aapl',
      source: 'site',
      metric: 'reviews',
      value: 3,
      note: 'up',
    })
    expect(created.status).toBe(201)
    expect(await json(created)).toMatchObject({ symbol: 'AAPL', value: 3 })
    const list = await call('GET', '/observations?symbol=aapl')
    const rows: { note: string }[] = await list.json()
    expect(rows.map((o) => o.note)).toEqual(['up'])
    expect(await (await call('GET', '/observations?symbol=msft')).json()).toEqual([])
  })
})

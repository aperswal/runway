import { beforeEach, describe, expect, it } from 'vitest'
import { INTERNAL_TOKEN, resetDb, seedFund, testEnv } from '../test/helpers'
import { app } from './app'

const env = testEnv()

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

describe('internal research routes', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })

  it('records and lists analyses', async () => {
    const created = await call('POST', '/analyses', {
      fund: 'social',
      kind: 'backtest',
      symbols: ['aapl'],
      title: 'Velocity',
      body: 'b',
      figures: { return: 3 },
      verdict: 'adopt',
    })
    expect(created.status).toBe(201)
    expect(await json(created)).toMatchObject({ symbols: 'AAPL', figures: { return: 3 } })
    const list = await call('GET', '/analyses?fund=social&kind=backtest&limit=5')
    expect(list.status).toBe(200)
    const rows: { title: string }[] = await list.json()
    expect(rows.map((a) => a.title)).toEqual(['Velocity'])
    expect((await call('GET', '/analyses?limit=0')).status).toBe(400)
    expect((await call('POST', '/analyses', { fund: 'social' })).status).toBe(400)
  })

  it('runs the plain rewrite on demand', async () => {
    const res = await call('POST', '/rewrite')
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ rewritten: 0 })
  })

  it('records and lists lessons', async () => {
    const created = await call('POST', '/lessons', {
      fund: 'social',
      kind: 'technical',
      lesson: 'RSI under 30 alone is not a buy.',
      tradeId: 1,
    })
    expect(created.status).toBe(201)
    expect(await json(created)).toMatchObject({ kind: 'technical', tradeId: 1 })
    const listed = await call('GET', '/lessons?fund=social')
    expect(listed.status).toBe(200)
    expect(await listed.json()).toHaveLength(1)
    const bad = await call('POST', '/lessons', { fund: 'social', kind: 'vibes', lesson: 'x' })
    expect(bad.status).toBe(400)
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

  it('creates, lists and resolves monitors', async () => {
    const created = await call('POST', '/monitors', {
      fund: 'social',
      symbol: 'aapl',
      event: 'earnings',
      eventAt: '2999-01-01T00:00:00.000Z',
      watch: 'guide',
    })
    expect(created.status).toBe(201)
    const monitor = await json(created)
    expect(monitor).toMatchObject({ symbol: 'AAPL', status: 'armed' })
    const list = await call('GET', '/monitors?fund=social&status=armed')
    const rows: { id: number }[] = await list.json()
    expect(rows.map((m) => m.id)).toEqual([monitor.id])
    expect((await call('GET', '/monitors?status=later')).status).toBe(400)
    const resolved = await call('PATCH', `/monitors/${String(monitor.id)}`, { outcome: 'beat' })
    expect(resolved.status).toBe(200)
    expect(await json(resolved)).toMatchObject({ status: 'done', outcome: 'beat' })
    expect((await call('PATCH', `/monitors/${String(monitor.id)}`, { outcome: 'x' })).status).toBe(
      422,
    )
    expect((await call('PATCH', '/monitors/abc', { outcome: 'x' })).status).toBe(400)
    expect((await call('POST', '/monitors', { fund: 'social' })).status).toBe(400)
  })
})

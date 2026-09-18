import { afterEach, describe, expect, it, vi } from 'vitest'
import { SiteError } from './errors.ts'
import { SiteClient, type RunReport } from './site.ts'

afterEach(() => vi.unstubAllGlobals())

const site = new SiteClient('https://runway.test', 'tok')
const headers = { authorization: 'Bearer tok', 'content-type': 'application/json' }
const report: RunReport = {
  trigger: 'cron',
  startedAt: '2024-01-01T00:00:00.000Z',
  finishedAt: '2024-01-01T00:01:00.000Z',
  model: 'claude',
  inputTokens: 1,
  outputTokens: 2,
  costUsd: 0.1,
  turns: 3,
  summary: 'done',
  error: null,
}

function stub(body: string, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const calls = [
  {
    name: 'context',
    call: () => site.context('0 6 * * *'),
    method: 'GET',
    path: '/internal/context?trigger=0%206%20*%20*%20*',
  },
  {
    name: 'openPosition',
    call: () => site.openPosition({ symbol: 'AAPL' }),
    method: 'POST',
    path: '/internal/positions',
    body: { symbol: 'AAPL' },
  },
  {
    name: 'closePosition',
    call: () => site.closePosition('BTC/USD', { fund: 'alpha', reason: 'took profit' }),
    method: 'DELETE',
    path: '/internal/positions/BTC%2FUSD',
    body: { fund: 'alpha', reason: 'took profit' },
  },
  {
    name: 'closePosition partial',
    call: () =>
      site.closePosition('AAPL', { fund: 'alpha', reason: 'half off at +2R', fraction: 0.5 }),
    method: 'DELETE',
    path: '/internal/positions/AAPL',
    body: { fund: 'alpha', reason: 'half off at +2R', fraction: 0.5 },
  },
  {
    name: 'adjustExits',
    call: () => site.adjustExits('AAPL', { stop: 1 }),
    method: 'PATCH',
    path: '/internal/positions/AAPL',
    body: { stop: 1 },
  },
  {
    name: 'recordRun',
    call: () => site.recordRun(report),
    method: 'POST',
    path: '/internal/runs',
    body: report,
  },
  {
    name: 'createFund',
    call: () => site.createFund({ id: 'alpha' }),
    method: 'POST',
    path: '/internal/funds',
    body: { id: 'alpha' },
  },
  {
    name: 'reallocateFund',
    call: () => site.reallocateFund('a/b', 0.5),
    method: 'PATCH',
    path: '/internal/funds/a%2Fb',
    body: { share: 0.5 },
  },
  {
    name: 'retireFund',
    call: () => site.retireFund('alpha', 'drift'),
    method: 'DELETE',
    path: '/internal/funds/alpha',
    body: { reason: 'drift' },
  },
  {
    name: 'recordAnalysis',
    call: () => site.recordAnalysis({ title: 'sma' }),
    method: 'POST',
    path: '/internal/analyses',
    body: { title: 'sma' },
  },
  {
    name: 'optionContracts',
    call: () => site.optionContracts({ underlying_symbols: 'AAPL', type: 'call' }),
    method: 'GET',
    path: '/internal/options/contracts?underlying_symbols=AAPL&type=call',
  },
  {
    name: 'cancelOrder',
    call: () => site.cancelOrder('BTC/USD', { fund: 'alpha', reason: 'changed mind' }),
    method: 'DELETE',
    path: '/internal/orders/BTC%2FUSD',
    body: { fund: 'alpha', reason: 'changed mind' },
  },
  {
    name: 'createMonitor',
    call: () => site.createMonitor({ symbol: 'AAPL' }),
    method: 'POST',
    path: '/internal/monitors',
    body: { symbol: 'AAPL' },
  },
  {
    name: 'listMonitors',
    call: () => site.listMonitors('a/b'),
    method: 'GET',
    path: '/internal/monitors?fund=a%2Fb',
  },
  {
    name: 'resolveMonitor',
    call: () => site.resolveMonitor(7, 'beat'),
    method: 'PATCH',
    path: '/internal/monitors/7',
    body: { outcome: 'beat' },
  },
  {
    name: 'recordObservation',
    call: () => site.recordObservation({ metric: 'reviews' }),
    method: 'POST',
    path: '/internal/observations',
    body: { metric: 'reviews' },
  },
  {
    name: 'recordNote',
    call: () => site.recordNote({ title: 'thesis' }),
    method: 'POST',
    path: '/internal/notes',
    body: { title: 'thesis' },
  },
  {
    name: 'recordLesson',
    call: () => site.recordLesson({ kind: 'psyche' }),
    method: 'POST',
    path: '/internal/lessons',
    body: { kind: 'psyche' },
  },
  {
    name: 'createJob',
    call: () => site.createJob({ fund: 'alpha', name: 'j' }),
    method: 'POST',
    path: '/internal/jobs',
    body: { fund: 'alpha', name: 'j' },
  },
  {
    name: 'listJobs',
    call: () => site.listJobs('alpha/1'),
    method: 'GET',
    path: '/internal/jobs?fund=alpha%2F1',
  },
  {
    name: 'cancelJob',
    call: () => site.cancelJob(7),
    method: 'DELETE',
    path: '/internal/jobs/7',
  },
  {
    name: 'trades',
    call: () => site.trades({ fund: 'alpha', status: 'closed' }),
    method: 'GET',
    path: '/internal/trades?fund=alpha&status=closed',
  },
  {
    name: 'research',
    call: () => site.research('observations', { fund: 'alpha', limit: '5' }),
    method: 'GET',
    path: '/internal/observations?fund=alpha&limit=5',
  },
  {
    name: 'research notes',
    call: () => site.research('notes', { fund: 'alpha' }),
    method: 'GET',
    path: '/internal/notes?fund=alpha',
  },
]

describe('SiteClient.context', () => {
  it('scopes the context to one fund when asked', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('ctx')))
    vi.stubGlobal('fetch', fetchMock)
    const client = new SiteClient('https://runway.test', 'tok')
    await expect(client.context('manual', 'my fund')).resolves.toBe('ctx')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://runway.test/internal/context?trigger=manual&fund=my%20fund',
      expect.anything(),
    )
    vi.unstubAllGlobals()
  })
})

describe('SiteClient.manager', () => {
  const json = { authorization: 'Bearer tok', 'content-type': 'application/json' }
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('starts the manager in its own container, polls for the report and parses the outcome', async () => {
    vi.useFakeTimers()
    const replies = [
      new Response('{"key":"k1"}', { status: 202 }),
      new Response('{"done":false,"outcome":null}'),
      new Response(
        '{"done":true,"outcome":{"result":{"type":"result"},"error":null,"seen":["x"]}}',
      ),
    ]
    const fetchMock = vi.fn(() => Promise.resolve(replies.shift()))
    vi.stubGlobal('fetch', fetchMock)
    const client = new SiteClient('https://runway.test', 'tok')
    const pending = client.manager('crypto', 'manual')
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(pending).resolves.toEqual({ result: { type: 'result' }, error: null, seen: ['x'] })
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://runway.test/internal/managers/crypto/run',
      {
        method: 'POST',
        headers: json,
        body: '{"trigger":"manual"}',
      },
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://runway.test/internal/managers/crypto/report?key=k1',
      { method: 'GET', headers: json, body: null },
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives up after the deadline and rejects a malformed outcome', async () => {
    vi.useFakeTimers()
    let started = false
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        const body = started ? '{"done":false,"outcome":null}' : '{"key":"k1"}'
        started = true
        return Promise.resolve(new Response(body))
      }),
    )
    const client = new SiteClient('https://runway.test', 'tok')
    const pending = client.manager('crypto', 'manual')
    await vi.advanceTimersByTimeAsync(56 * 60_000)
    await expect(pending).resolves.toEqual({
      result: undefined,
      error: 'manager crypto did not report within 55 minutes',
      seen: [],
    })
    const bad = [new Response('{"key":"k2"}'), new Response('{"done":true,"outcome":{"nope":1}}')]
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(bad.shift())),
    )
    const rejected = expect(client.manager('crypto', 'manual')).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(30_000)
    await rejected
  })

  it('keeps polling through a failed or malformed poll', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const replies = [
      new Response('{"key":"k3"}', { status: 202 }),
      new Response('down', { status: 503 }),
      new Response('{"weird":true}'),
      new Response('{"done":true,"outcome":{"error":"late","seen":[]}}'),
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(replies.shift())),
    )
    const client = new SiteClient('https://runway.test', 'tok')
    const pending = client.manager('crypto', 'manual')
    await vi.advanceTimersByTimeAsync(90_000)
    await expect(pending).resolves.toEqual({ error: 'late', seen: [] })
    expect(errorSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        '"message":"manager report poll failed","fund":"crypto","error":"site 503: down"',
      ),
    )
    errorSpy.mockRestore()
  })

  it('reports an outcome back to the site', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{"ok":true}')))
    vi.stubGlobal('fetch', fetchMock)
    const client = new SiteClient('https://runway.test', 'tok')
    const outcome = { result: undefined, error: 'x', seen: [] }
    await expect(client.report('crypto', 'k1', outcome)).resolves.toBe('{"ok":true}')
    expect(fetchMock).toHaveBeenCalledWith('https://runway.test/internal/managers/crypto/report', {
      method: 'POST',
      headers: json,
      body: '{"key":"k1","outcome":{"error":"x","seen":[]}}',
    })
  })
})

describe('SiteClient', () => {
  it.each(calls)('$name sends $method $path', async ({ call, method, path, body }) => {
    const fetchMock = stub('reply')
    await expect(call()).resolves.toBe('reply')
    expect(fetchMock).toHaveBeenCalledWith(`https://runway.test${path}`, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    })
  })
  it('funds parses the fund list', async () => {
    const fund = { id: 'alpha', name: 'Alpha', mandate: 'm', share: 0.5, status: 'active' }
    const fetchMock = stub(JSON.stringify([fund]))
    await expect(site.funds()).resolves.toEqual([fund])
    expect(fetchMock).toHaveBeenCalledWith('https://runway.test/internal/funds', {
      method: 'GET',
      headers,
      body: null,
    })
  })
  it('funds rejects an unexpected shape', async () => {
    stub('[{"id":1}]')
    await expect(site.funds()).rejects.toThrow()
  })
  it('throws SiteError with the status and body on failure', async () => {
    stub('market closed', 422)
    const error = await site.context('cron').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SiteError)
    expect(error).toMatchObject({ status: 422, body: 'market closed' })
  })
})

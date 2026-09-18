import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from './env.ts'
import type { QueryOutcome } from './run.ts'
import { createServer, parseJob, readTrigger, start } from './server.ts'

const mocks = vi.hoisted(() => ({ runAgent: vi.fn(), runOneManager: vi.fn() }))
vi.mock('./run.ts', () => ({ runAgent: mocks.runAgent, runOneManager: mocks.runOneManager }))

const env = {
  SITE_URL: 'https://runway.test',
  INTERNAL_TOKEN: 'internal-token-long-enough',
  DATA_TOKEN: 'data-token-long-enough-too',
  PATH: '/usr/bin:/bin',
  HOME: '/home/runway',
}
const config = loadConfig(env)
const auth = { authorization: `Bearer ${env.INTERNAL_TOKEN}` }
const servers: http.Server[] = []

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void }
function deferred(): Deferred {
  let resolve: (value: unknown) => void = vi.fn()
  const promise = new Promise<unknown>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function listen(
  run: (trigger: string) => Promise<unknown>,
  manager: (fund: string, trigger: string) => Promise<QueryOutcome> = vi.fn(),
  report: (fund: string, key: string, outcome: QueryOutcome) => Promise<unknown> = vi.fn(),
) {
  const { server, state } = createServer(config, run, manager, report)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  return { state, url: `http://127.0.0.1:${port}` }
}

const request = (body: string, extra: Partial<http.IncomingMessage> = {}): http.IncomingMessage =>
  Object.assign(
    Readable.from(body.length === 0 ? [] : [Buffer.from(body)]),
    extra,
  ) as http.IncomingMessage

let logSpy = vi.spyOn(console, 'log')

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
})

describe('createServer', () => {
  it('reports health with a live probe of the site', async () => {
    const { url } = await listen(vi.fn())
    const real = globalThis.fetch
    const probe = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      (input instanceof Request ? input.url : String(input)) === 'https://runway.test/api/summary'
        ? Promise.resolve(new Response('{}', { status: 200 }))
        : real(input, init),
    )
    vi.stubGlobal('fetch', probe)
    const res = await real(`${url}/health`)
    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toEqual({
      ok: true,
      siteUrl: 'https://runway.test',
      site: 'status 200',
      running: false,
      stopping: false,
    })
    expect(probe.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
      (input instanceof Request ? input.url : String(input)) === 'https://runway.test/api/summary'
        ? Promise.reject(new Error('boom'))
        : real(input, init),
    )
    await expect((await real(`${url}/health`)).json()).resolves.toMatchObject({
      site: 'error: boom',
    })
    vi.unstubAllGlobals()
  })
  it.each([
    { method: 'GET', path: '/run' },
    { method: 'POST', path: '/health' },
    { method: 'POST', path: '/other' },
  ])('returns 404 for $method $path', async ({ method, path }) => {
    const { url } = await listen(vi.fn())
    const res = await fetch(`${url}${path}`, { method, headers: auth })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toBe('application/json')
    await expect(res.json()).resolves.toEqual({ error: 'not found' })
  })
  it('returns 401 without the bearer token', async () => {
    const run = vi.fn()
    const { url } = await listen(run)
    const res = await fetch(`${url}/run`, { method: 'POST' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(run).not.toHaveBeenCalled()
  })
  it('runs managers through runOneManager and reports to the site by default', async () => {
    const outcome = { result: undefined, error: 'x', seen: [] }
    mocks.runOneManager.mockResolvedValue(outcome)
    const realFetch = globalThis.fetch
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetchMock)
    const { server } = createServer(config, vi.fn())
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, resolve))
    const { port } = server.address() as AddressInfo
    const res = await realFetch(`http://127.0.0.1:${port}/manager`, {
      method: 'POST',
      headers: auth,
      body: '{"fund":"quant","trigger":"manual","key":"k1","codexAuth":"{\\"tokens\\":{}}"}',
    })
    expect(res.status).toBe(202)
    expect(mocks.runOneManager).toHaveBeenCalledWith('quant', 'manual', config, '{"tokens":{}}')
    await vi.waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        'https://runway.test/internal/managers/quant/report',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ key: 'k1', outcome }) }),
      ),
    )
    vi.unstubAllGlobals()
  })

  it('accepts a manager run, then reports its outcome when it finishes', async () => {
    const outcome = { result: undefined, error: null, seen: [] }
    const manager = vi.fn().mockResolvedValue(outcome)
    const report = vi.fn().mockResolvedValue('{"ok":true}')
    const { url } = await listen(vi.fn(), manager, report)
    const res = await fetch(`${url}/manager`, {
      method: 'POST',
      headers: auth,
      body: '{"fund":"quant","trigger":"0 6 * * *","key":"k9"}',
    })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ started: 'quant' })
    expect(manager).toHaveBeenCalledWith('quant', '0 6 * * *', undefined)
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith('quant', 'k9', outcome))
    const bad = await fetch(`${url}/manager`, { method: 'POST', headers: auth, body: '{}' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'body must be {fund, trigger, key}' })
  })

  it('logs a manager that crashes or cannot report', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const manager = vi.fn().mockRejectedValue(new Error('exploded'))
    const { url } = await listen(vi.fn(), manager)
    const res = await fetch(`${url}/manager`, {
      method: 'POST',
      headers: auth,
      body: '{"fund":"quant","trigger":"manual","key":"k1"}',
    })
    expect(res.status).toBe(202)
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        JSON.stringify({
          level: 'error',
          message: 'manager failed',
          fund: 'quant',
          error: 'exploded',
        }),
      ),
    )
  })

  it('accepts a run and executes it with the trigger', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const { url, state } = await listen(run)
    const res = await fetch(`${url}/run`, {
      method: 'POST',
      headers: auth,
      body: '{"trigger":"cron"}',
    })
    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toEqual({ started: 'cron' })
    await vi.waitFor(() => expect(run).toHaveBeenCalledWith('cron'))
    await vi.waitFor(() => expect(state.running).toBe(false))
    expect(logSpy).toHaveBeenCalledWith('{"level":"info","message":"run started","trigger":"cron"}')
    expect(logSpy).toHaveBeenCalledWith(
      '{"level":"info","message":"run finished","trigger":"cron"}',
    )
  })
  it('rejects a second run while one is in progress', async () => {
    const gate = deferred()
    const { url, state } = await listen(() => gate.promise)
    const first = await fetch(`${url}/run`, { method: 'POST', headers: auth })
    expect(first.status).toBe(202)
    await expect(first.json()).resolves.toEqual({ started: 'http' })
    await vi.waitFor(() => expect(state.running).toBe(true))
    const second = await fetch(`${url}/run`, { method: 'POST', headers: auth })
    expect(second.status).toBe(409)
    await expect(second.json()).resolves.toEqual({ error: 'run in progress' })
    gate.resolve(undefined)
    await vi.waitFor(() => expect(state.running).toBe(false))
  })
  it('logs a failing run and frees the slot', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { url, state } = await listen(() => Promise.reject(new Error('boom')))
    await fetch(`${url}/run`, { method: 'POST', headers: auth })
    await vi.waitFor(() =>
      expect(err).toHaveBeenCalledWith(
        '{"level":"error","message":"run failed","trigger":"http","error":"boom"}',
      ),
    )
    expect(state.running).toBe(false)
  })
})

describe('readTrigger', () => {
  it.each([
    { body: '', trigger: 'http' },
    { body: 'null', trigger: 'http' },
    { body: '"cron"', trigger: 'http' },
    { body: '{"other":1}', trigger: 'http' },
    { body: '{"trigger":1}', trigger: 'http' },
    { body: '{"trigger":["a"]}', trigger: 'http' },
    { body: '{"trigger":""}', trigger: 'http' },
    { body: '{"trigger":"open"}', trigger: 'open' },
  ])('reads $trigger from $body', async ({ body, trigger }) =>
    expect(await readTrigger(request(body))).toBe(trigger),
  )
})

describe('start', () => {
  it('listens on 8080 and finishes the current run on SIGTERM', async () => {
    Object.entries(env).forEach(([key, value]) => vi.stubEnv(key, value))
    const listeners = new Map<string, () => void>()
    const requestListeners: http.RequestListener[] = []
    const fakeServer = { listen: vi.fn((_port: number, cb: () => void) => cb()), close: vi.fn() }
    vi.spyOn(http, 'createServer').mockImplementation((listener) => {
      requestListeners.push(listener as unknown as http.RequestListener)
      return fakeServer as unknown as http.Server
    })
    vi.spyOn(process, 'on').mockImplementation((event, listener) => {
      listeners.set(String(event), listener as () => void)
      return process
    })
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const gate = deferred()
    mocks.runAgent.mockReturnValue(gate.promise)

    start()
    expect(fakeServer.listen).toHaveBeenCalledWith(8080, expect.any(Function))
    expect(logSpy).toHaveBeenCalledWith('{"level":"info","message":"agent listening on 8080"}')
    const sigterm = listeners.get('SIGTERM')!
    sigterm()
    expect(fakeServer.close).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(0)

    const health = { writeHead: vi.fn(), end: vi.fn() }
    vi.stubGlobal('fetch', () => Promise.reject(new Error('down')))
    requestListeners[0]!(
      request('', { method: 'GET', url: '/health' }),
      health as unknown as http.ServerResponse,
    )
    await vi.waitFor(() =>
      expect(health.end).toHaveBeenCalledWith(
        '{"ok":true,"siteUrl":"https://runway.test","site":"error: down","running":false,"stopping":true}',
      ),
    )
    vi.unstubAllGlobals()

    const res = { writeHead: vi.fn(), end: vi.fn() }
    requestListeners[0]!(
      request('{"trigger":"cron"}', { method: 'POST', url: '/run', headers: auth }),
      res as unknown as http.ServerResponse,
    )
    await vi.waitFor(() => expect(res.end).toHaveBeenCalledWith('{"started":"cron"}'))
    expect(mocks.runAgent).toHaveBeenCalledWith('cron')
    sigterm()
    expect(exit).toHaveBeenCalledOnce()
    expect(logSpy).toHaveBeenCalledWith(
      '{"level":"info","message":"SIGTERM received, finishing the current run"}',
    )
    gate.resolve(undefined)
  })
})

describe('parseJob', () => {
  it('requires a script and clamps the timeout', () => {
    expect(parseJob('')).toBeNull()
    expect(parseJob('{"nope":1}')).toBeNull()
    expect(parseJob('"text"')).toBeNull()
    expect(parseJob('{"script":"echo"}')).toEqual({ script: 'echo', timeoutSeconds: 300 })
    expect(parseJob('{"script":"echo","timeoutSeconds":5}')).toEqual({
      script: 'echo',
      timeoutSeconds: 5,
    })
    expect(parseJob('{"script":"echo","timeoutSeconds":5000}')).toEqual({
      script: 'echo',
      timeoutSeconds: 900,
    })
    expect(parseJob('{"script":"echo","timeoutSeconds":0}')).toEqual({
      script: 'echo',
      timeoutSeconds: 1,
    })
    expect(parseJob('{"script":"echo","timeoutSeconds":"x"}')).toEqual({
      script: 'echo',
      timeoutSeconds: 300,
    })
  })
})

describe('POST /job', () => {
  it('runs a script in the job sandbox with only the data token and returns its result', async () => {
    const { url } = await listen(vi.fn())
    const res = await fetch(`${url}/job`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        script: 'echo "$DATA_TOKEN|$INTERNAL_TOKEN|$SITE_URL"; exit 2',
        timeoutSeconds: 10,
      }),
    })
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      exitCode: 2,
      timedOut: false,
      output: `${env.DATA_TOKEN}||${env.SITE_URL}\n`,
    })
    expect(logSpy).toHaveBeenCalledWith(
      '{"level":"info","message":"job started","timeoutSeconds":10}',
    )
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\{"level":"info","message":"job finished","exitCode":2,"timedOut":false,"durationMs":\d+\}$/,
      ),
    )
  })
  it('rejects a bad body and a missing bearer', async () => {
    const { url } = await listen(vi.fn())
    const bad = await fetch(`${url}/job`, { method: 'POST', headers: auth, body: '{}' })
    expect(bad.status).toBe(400)
    await expect(bad.json()).resolves.toEqual({ error: 'body must be {script, timeoutSeconds?}' })
    const anon = await fetch(`${url}/job`, { method: 'POST', body: '{"script":"echo"}' })
    expect(anon.status).toBe(401)
  })
})

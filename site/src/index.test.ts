import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  ALPACA,
  X_CONFIG,
  accountJson,
  clockJson,
  db,
  insertSnapshot,
  insertTrade,
  resetDb,
  seedFund,
  stubFetch,
  testEnv,
} from '../test/helpers'
import { distributions, monitors, snapshots } from './db/schema'
import { previousMonth } from './distributions'
import type { PostJob } from './env'
import worker, { retryDelaySeconds } from './index'

vi.mock('@cloudflare/containers', () => ({
  Container: class {
    envVars: Record<string, string> = {}
    ctx: unknown
    env: unknown
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx
      this.env = env
    }
  },
  getContainer: vi.fn(),
}))

const cron = (expression: string): ScheduledEvent =>
  createScheduledController({ cron: expression }) as unknown as ScheduledEvent

const fakeAgent = (
  status: number,
  body = '',
): {
  agent: DurableObjectNamespace
  fetch: ReturnType<typeof vi.fn>
  idFromName: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
} => {
  const fetch = vi.fn(() => Promise.resolve(new Response(body, { status })))
  const destroy = vi.fn(() => Promise.resolve())
  const idFromName = vi.fn(() => 'agent-id')
  const agent = { idFromName, get: vi.fn(() => ({ fetch, destroy })) }
  return { agent: agent as unknown as DurableObjectNamespace, fetch, idFromName, destroy }
}

describe('retryDelaySeconds', () => {
  it('doubles from a minute and caps at an hour', () => {
    expect(retryDelaySeconds(0)).toBe(60)
    expect(retryDelaySeconds(1)).toBe(120)
    expect(retryDelaySeconds(5)).toBe(1920)
    expect(retryDelaySeconds(6)).toBe(3600)
    expect(retryDelaySeconds(10)).toBe(3600)
  })
})

describe('fetch', () => {
  it('starts a manual agent run and reports container health through the internal API', async () => {
    const { agent, fetch, idFromName, destroy } = fakeAgent(202, '{"started":"manual"}')
    const env = testEnv({ AGENT: agent })
    const headers = { authorization: 'Bearer internal-token-0123456789' }
    const run = await worker.fetch(
      new Request('http://site.test/internal/agent/run', { method: 'POST', headers }),
      env,
      createExecutionContext(),
    )
    expect(run.status).toBe(202)
    expect(await run.text()).toBe('{"started":"manual"}')
    const request = fetch.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('http://agent/run')
    expect(await request.json()).toEqual({ trigger: 'manual' })
    const health = await worker.fetch(
      new Request('http://site.test/internal/agent/health', { headers }),
      env,
      createExecutionContext(),
    )
    expect(health.status).toBe(200)
    expect((fetch.mock.calls[1]?.[0] as Request).url).toBe('http://agent/health')
    expect(idFromName).toHaveBeenCalledTimes(2)
    expect(idFromName).toHaveBeenLastCalledWith('agent')
    const restart = await worker.fetch(
      new Request('http://site.test/internal/agent/restart', { method: 'POST', headers }),
      env,
      createExecutionContext(),
    )
    expect(restart.status).toBe(202)
    expect(await restart.text()).toBe('restarting')
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(idFromName).toHaveBeenCalledTimes(3)
    expect(idFromName).toHaveBeenLastCalledWith('agent')
    const refused = await worker.fetch(
      new Request('http://site.test/internal/agent/run', { method: 'POST', headers }),
      testEnv({ AGENT: fakeAgent(409, 'busy').agent }),
      createExecutionContext(),
    )
    expect(refused.status).toBe(502)
    expect(await refused.json()).toMatchObject({ error: 'upstream', message: 'agent 409: busy' })
  })
  it('delegates to the app', async () => {
    const res = await worker.fetch(
      new Request('http://site.test/api/summary'),
      testEnv(),
      createExecutionContext(),
    )
    expect(res.status).toBe(200)
  })
})

describe('scheduled', () => {
  beforeEach(resetDb)
  afterEach(() => vi.unstubAllGlobals())

  it('snapshots and enforces exits on the quarter hour', async () => {
    stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson({ equity: '999' }) },
      { url: `${ALPACA}/v2/clock`, body: clockJson(false) },
      { url: `${ALPACA}/v2/positions`, body: [] },
    ])
    const ctx = createExecutionContext()
    await db.insert(monitors).values({
      fund: 'social',
      symbol: 'AAPL',
      event: 'earnings',
      eventAt: '2000-01-01T00:00:00.000Z',
      watch: 'w',
      status: 'armed',
      createdAt: '2000-01-01T00:00:00.000Z',
    })
    worker.scheduled(cron('*/15 * * * *'), testEnv(), ctx)
    await waitOnExecutionContext(ctx)
    expect(await db.select().from(snapshots)).toMatchObject([{ equity: 999 }])
    expect(await db.select().from(monitors)).toMatchObject([{ status: 'due' }])
  })

  it('closes the previous month on the first', async () => {
    const month = previousMonth(new Date())
    await insertSnapshot({ takenAt: `${month}-01T00:00:00.000Z`, equity: 1000 })
    await insertSnapshot({ takenAt: `${month}-02T00:00:00.000Z`, equity: 1500 })
    const ctx = createExecutionContext()
    worker.scheduled(cron('5 5 1 * *'), testEnv(), ctx)
    await waitOnExecutionContext(ctx)
    expect(await db.select().from(distributions)).toMatchObject([
      { month, startEquity: 1000, endEquity: 1500 },
    ])
  })

  it('starts the agent container for the remaining crons', async () => {
    const { agent, fetch, idFromName } = fakeAgent(202)
    const ctx = createExecutionContext()
    worker.scheduled(cron('30 14 * * 1-5'), testEnv({ AGENT: agent }), ctx)
    await waitOnExecutionContext(ctx)
    expect(idFromName).toHaveBeenCalledWith('agent')
    expect(fetch).toHaveBeenCalledTimes(1)
    const request = fetch.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('http://agent/run')
    expect(request.method).toBe('POST')
    expect(request.headers.get('authorization')).toBe('Bearer internal-token-0123456789')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(await request.json()).toEqual({ trigger: '30 14 * * 1-5' })
  })

  it('logs and rethrows when the container refuses the run', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { agent } = fakeAgent(500, 'busy')
    const ctx = createExecutionContext()
    worker.scheduled(cron('0 19 * * 1-5'), testEnv({ AGENT: agent }), ctx)
    await expect(waitOnExecutionContext(ctx)).rejects.toThrow('agent 500: busy')
    expect(error).toHaveBeenCalledWith(
      JSON.stringify({
        level: 'error',
        message: 'cron failed',
        cron: '0 19 * * 1-5',
        error: 'agent 500: busy',
      }),
    )
    vi.restoreAllMocks()
  })
})

describe('queue', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  type FakeMessage = {
    id: string
    timestamp: Date
    body: PostJob
    attempts: number
    ack: Mock<() => void>
    retry: Mock<(options?: QueueRetryOptions) => void>
  }

  const batchOf = (
    jobs: { body: PostJob; attempts: number }[],
  ): { batch: MessageBatch<PostJob>; messages: FakeMessage[] } => {
    const messages = jobs.map((m, i) => ({
      id: `m${i}`,
      timestamp: new Date(),
      body: m.body,
      attempts: m.attempts,
      ack: vi.fn((): void => undefined),
      retry: vi.fn((_options?: QueueRetryOptions): void => undefined),
    }))
    const batch = { queue: 'runway-posts', messages, ackAll: vi.fn(), retryAll: vi.fn() }
    return { batch: batch as unknown as MessageBatch<PostJob>, messages }
  }

  it('acks published jobs and retries failed ones with backoff', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    stubFetch([{ url: 'https://x.test/2/tweets', method: 'POST', status: 503, body: 'down' }])
    const posted = await insertTrade({ symbol: 'AAPL', qty: 0, status: 'closed' })
    const failing = await insertTrade({ symbol: 'MSFT' })
    const { batch, messages } = batchOf([
      { body: { tradeId: posted.id, kind: 'sell' }, attempts: 1 },
      { body: { tradeId: failing.id, kind: 'buy' }, attempts: 3 },
    ])
    await worker.queue(batch, testEnv(X_CONFIG))
    expect(messages[0]?.ack).toHaveBeenCalledTimes(1)
    expect(messages[0]?.retry).not.toHaveBeenCalled()
    expect(messages[1]?.ack).not.toHaveBeenCalled()
    expect(messages[1]?.retry).toHaveBeenCalledWith({ delaySeconds: 480 })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"message":"post failed"'))
  })

  it('propagates unknown trades', async () => {
    const { batch } = batchOf([{ body: { tradeId: 999, kind: 'buy' }, attempts: 1 }])
    await expect(worker.queue(batch, testEnv())).rejects.toThrow('post job for unknown trade 999')
  })
})

describe('AgentContainer', () => {
  it('passes the agent secrets into the container environment', async () => {
    vi.resetModules()
    const fresh = await import('./index')
    const env = testEnv({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      AGENT_MODEL: 'opus',
      APIFY_TOKEN: 'apify',
    })
    const state = {} as unknown as ConstructorParameters<typeof fresh.AgentContainer>[0]
    const container = new fresh.AgentContainer(state, env)
    expect(container.envVars).toEqual({
      SITE_URL: 'http://site.test',
      INTERNAL_TOKEN: 'internal-token-0123456789',
      DATA_TOKEN: 'data-token-0123456789abc',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      AGENT_MODEL: 'opus',
      MANAGER_MODEL: '',
      APIFY_TOKEN: 'apify',
    })
    expect(container.defaultPort).toBe(8080)
    expect(container.sleepAfter).toBe('45m')
  })

  it('blanks optional agent settings', async () => {
    vi.resetModules()
    const fresh = await import('./index')
    const state = {} as unknown as ConstructorParameters<typeof fresh.AgentContainer>[0]
    const container = new fresh.AgentContainer(state, testEnv())
    expect(container.envVars).toStrictEqual({
      SITE_URL: 'http://site.test',
      INTERNAL_TOKEN: 'internal-token-0123456789',
      DATA_TOKEN: 'data-token-0123456789abc',
      CLAUDE_CODE_OAUTH_TOKEN: '',
      AGENT_MODEL: '',
      MANAGER_MODEL: '',
    })
  })
})

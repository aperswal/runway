import { env } from 'cloudflare:workers'
import { vi, type Mock } from 'vitest'
import { createDb, type Db } from '../src/db/client'
import {
  analyses,
  codexAuth,
  distributions,
  funds,
  jobs,
  managerRuns,
  monitors,
  notes,
  lessons,
  observations,
  plain,
  posts,
  runs,
  snapshots,
  trades,
  type Fund,
  type Snapshot,
  type Trade,
} from '../src/db/schema'
import type { Bindings, PostJob } from '../src/env'

import { ALPACA, DATA, DATA_TOKEN, INTERNAL_TOKEN, TEST_CONFIG } from './config'

export { ALPACA, DATA, DATA_TOKEN, INTERNAL_TOKEN, TEST_CONFIG }
const HTTP_OK = 200

export const X_CONFIG = {
  X_API_KEY: 'x-key',
  X_API_SECRET: 'x-secret',
  X_ACCESS_TOKEN: 'x-token',
  X_ACCESS_SECRET: 'x-token-secret',
}

export const LINKEDIN_CONFIG = {
  LINKEDIN_ACCESS_TOKEN: 'li-token',
  LINKEDIN_PERSON_URN: 'urn:li:person:abc',
}

export type TestEnv = Bindings & Record<string, unknown>

export type FakeQueue = { queue: Queue<PostJob>; send: Mock<(job: PostJob) => Promise<void>> }

export function fakeQueue(): FakeQueue {
  const send = vi.fn((_job: PostJob): Promise<void> => Promise.resolve())
  const queue = { send, sendBatch: vi.fn() }
  return { queue: queue as unknown as Queue<PostJob>, send }
}

export function testEnv(overrides: Record<string, unknown> = {}): TestEnv {
  return { ...env, ...TEST_CONFIG, POSTS: fakeQueue().queue, ...overrides }
}

export const db: Db = createDb(env.DB)

export async function resetDb(): Promise<void> {
  const tables = [
    trades,
    posts,
    runs,
    snapshots,
    distributions,
    analyses,
    monitors,
    observations,
    notes,
    lessons,
    plain,
    jobs,
    managerRuns,
    codexAuth,
    funds,
  ]
  for (const table of tables) {
    await db.delete(table)
  }
}

const BASE_FUND: typeof funds.$inferInsert = {
  id: 'social',
  name: 'Social signal',
  mandate: 'Find products whose customer enthusiasm is changing faster than the market noticed.',
  share: 0.5,
  capital: 500,
  highWater: 500,
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
}

export async function seedFund(overrides: Partial<Fund> = {}): Promise<Fund> {
  const [row] = await db
    .insert(funds)
    .values({ ...BASE_FUND, ...overrides })
    .returning()
  if (row === undefined) {
    throw new RangeError('fund insert returned nothing')
  }
  return row
}

const BASE_TRADE: typeof trades.$inferInsert = {
  fund: 'social',
  symbol: 'AAPL',
  assetClass: 'us_equity',
  notional: 100,
  qty: 0.5,
  entryPrice: 200,
  stop: 180,
  target: 240,
  horizon: '2 weeks',
  reason: 'Review velocity is accelerating',
  status: 'open',
  openedAt: '2026-08-20T14:00:00.000Z',
}

export async function insertTrade(overrides: Partial<Trade> = {}): Promise<Trade> {
  const [row] = await db
    .insert(trades)
    .values({ ...BASE_TRADE, ...overrides })
    .returning()
  if (row === undefined) {
    throw new RangeError('trade insert returned nothing')
  }
  return row
}

export async function insertSnapshot(overrides: Partial<Snapshot> = {}): Promise<Snapshot> {
  const [row] = await db
    .insert(snapshots)
    .values({
      takenAt: '2026-09-01T12:00:00.000Z',
      equity: 1000,
      cash: 800,
      positions: [],
      ...overrides,
    })
    .returning()
  if (row === undefined) {
    throw new RangeError('snapshot insert returned nothing')
  }
  return row
}

const snake = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v]),
  )

type Json = Record<string, unknown>

export const accountJson = (o: Json = {}): Json =>
  snake({ equity: '1000', cash: '800', daytradeCount: 0, patternDayTrader: false, ...o })

export const clockJson = (isOpen = true): Json =>
  snake({ isOpen, nextOpen: '2026-09-02T13:30:00Z', nextClose: '2026-09-01T20:00:00Z' })

export const orderJson = (o: Json = {}): Json =>
  snake({
    id: 'ord-1',
    symbol: 'AAPL',
    status: 'filled',
    filledAvgPrice: '200',
    filledQty: '0.5',
    ...o,
  })

export const liveRoutes = (positions: Json[] = []): Route[] => [
  { url: `${ALPACA}/v2/account`, body: accountJson() },
  { url: `${ALPACA}/v2/positions`, body: positions },
]

export const assetJson = (o: Json = {}): Json =>
  snake({
    symbol: 'AAPL',
    class: 'us_equity',
    tradable: true,
    fractionable: true,
    status: 'active',
    ...o,
  })

export const positionJson = (o: Json = {}): Json =>
  snake({
    symbol: 'AAPL',
    qty: '0.5',
    avgEntryPrice: '200',
    currentPrice: '210',
    marketValue: '105',
    unrealizedPl: '5',
    assetClass: 'us_equity',
    ...o,
  })

export const headlineJson = (o: Json = {}): Json =>
  snake({
    headline: 'Apple beats',
    createdAt: '2026-09-01T12:00:00Z',
    symbols: ['AAPL'],
    source: 'wire',
    ...o,
  })

export const latestTradesJson = (prices: Record<string, number>): Json => ({
  trades: Object.fromEntries(Object.entries(prices).map(([s, p]) => [s, { p }])),
})

export type Route = {
  url: string | RegExp
  method?: string
  status?: number
  body?: unknown
  headers?: Record<string, string>
  times?: number
}

export type FetchCall = { url: string; method: string; init: RequestInit | undefined }

export type FetchStub = { calls: FetchCall[]; fetch: Mock }

const requestUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.toString() : input.url
}

const matches = (route: Route, url: string, method: string): boolean =>
  (route.method ?? 'GET') === method &&
  (typeof route.url === 'string' ? route.url === url : route.url.test(url))

const toResponse = (route: Route): Response => {
  const init = { status: route.status ?? HTTP_OK, headers: route.headers ?? {} }
  return typeof route.body === 'string'
    ? new Response(route.body, init)
    : Response.json(route.body ?? {}, init)
}

export function stubFetch(routes: Route[]): FetchStub {
  const calls: FetchCall[] = []
  const remaining = routes.map((r) => ({ route: r, left: r.times ?? Infinity }))
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({ url, method, init })
    const hit = remaining.find((r) => r.left > 0 && matches(r.route, url, method))
    if (hit === undefined) {
      return Promise.reject(new TypeError(`unexpected fetch ${method} ${url}`))
    }
    hit.left -= 1
    return Promise.resolve(toResponse(hit.route))
  })
  vi.stubGlobal('fetch', fetch)
  return { calls, fetch }
}

export const jsonBody = (call: FetchCall | undefined): Record<string, unknown> => {
  const body = call?.init?.body
  return JSON.parse(typeof body === 'string' ? body : '{}') as Record<string, unknown>
}

export const headerOf = (call: FetchCall | undefined, name: string): string | undefined =>
  new Headers(call?.init?.headers).get(name) ?? undefined

export function stubDb(results: unknown[]): Db {
  const queue = [...results]
  const chain: unknown = new Proxy(() => undefined, {
    get: (_target, key) => {
      if (key === 'then') {
        return (resolve: (value: unknown) => void) => resolve(queue.shift() ?? [])
      }
      return () => chain
    },
    apply: () => chain,
  })
  return chain as Db
}

export const fakeAgent = (responses: { status: number; body: string }[]) => {
  const fetch = vi.fn((_request: Request) => {
    const next = responses.shift() ?? { status: 500, body: 'exhausted' }
    return Promise.resolve(new Response(next.body, { status: next.status }))
  })
  const idFromName = vi.fn(() => 'id')
  const destroy = vi.fn(() => Promise.resolve())
  const agent = { idFromName, get: vi.fn(() => ({ fetch, destroy })) }
  return { agent: agent as unknown as DurableObjectNamespace, fetch, idFromName, destroy }
}

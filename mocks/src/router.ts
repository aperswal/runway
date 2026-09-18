import { createData } from './alpaca/data.ts'
import { PriceFeed } from './alpaca/prices.ts'
import { AlpacaState } from './alpaca/state.ts'
import { createTrading } from './alpaca/trading.ts'
import { createControl } from './control.ts'
import { createDeepInfra } from './deepinfra.ts'
import type { MockConfig } from './env.ts'
import { AlpacaUnauthorizedError, ApiError, STATUS } from './errors.ts'
import { headerPresent, json, toMockRequest, type Handler } from './http.ts'
import { createLinkedIn } from './linkedin.ts'
import { PostStore } from './posts.ts'
import { createX } from './x.ts'

export type Deps = {
  config: MockConfig
  state: AlpacaState
  posts: PostStore
  now: () => Date
}

export type RequestHandler = (request: Request) => Promise<Response>

export const PREFIXES = [
  '/alpaca',
  '/alpaca-data',
  '/x',
  '/linkedin',
  '/deepinfra',
  '/_control',
] as const
type Prefix = (typeof PREFIXES)[number]

export function createDeps(config: MockConfig, now: () => Date = () => new Date()): Deps {
  return {
    config,
    state: new AlpacaState(config.startCash, new PriceFeed(), now),
    posts: new PostStore(),
    now,
  }
}

const withAlpacaAuth =
  (handler: Handler): Handler =>
  (request) => {
    const authorized =
      headerPresent(request.headers, 'apca-api-key-id') &&
      headerPresent(request.headers, 'apca-api-secret-key')
    if (!authorized) {
      throw new AlpacaUnauthorizedError()
    }
    return handler(request)
  }

const splitPrefix = (pathname: string): { prefix: Prefix; rest: string } | null => {
  const prefix = PREFIXES.find((p) => pathname === p || pathname.startsWith(`${p}/`))
  if (prefix === undefined) {
    return null
  }
  return { prefix, rest: pathname.slice(prefix.length) }
}

export function createHandler(deps: Deps): RequestHandler {
  const { state, posts, now, config } = deps
  const fakes: Record<Prefix, Handler> = {
    '/alpaca': withAlpacaAuth(createTrading({ state, now, marketOpen: config.marketOpen })),
    '/alpaca-data': withAlpacaAuth(createData({ prices: state.prices, now })),
    '/x': createX({ posts, now }),
    '/linkedin': createLinkedIn({ posts, now }),
    '/deepinfra': createDeepInfra(),
    '/_control': createControl({ state, posts }),
  }
  return async (request) => {
    const split = splitPrefix(new URL(request.url).pathname)
    if (split === null) {
      return json({ message: 'unknown mock prefix', prefixes: PREFIXES }, STATUS.notFound)
    }
    try {
      return fakes[split.prefix](await toMockRequest(request, split.rest))
    } catch (error) {
      if (error instanceof ApiError) {
        return json(error.body, error.status)
      }
      throw error
    }
  }
}

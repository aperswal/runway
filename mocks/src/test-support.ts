import type { MockConfig } from './env.ts'
import { createDeps, createHandler, type Deps, type RequestHandler } from './router.ts'

const FIXED_NOW = new Date('2026-09-01T15:00:00.000Z')
export const ALPACA_HEADERS = { 'apca-api-key-id': 'key', 'apca-api-secret-key': 'secret' }
export const BASE_CONFIG: MockConfig = { port: 0, startCash: 1000, marketOpen: undefined }

export type CallInit = { headers?: Record<string, string>; body?: unknown }
export type Call = (method: string, path: string, init?: CallInit) => Promise<Response>

export const buildRequest = (method: string, path: string, init: CallInit = {}): Request =>
  new Request(`http://mocks${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...init.headers },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  })

export function setup(
  overrides: Partial<MockConfig> = {},
  now: () => Date = () => FIXED_NOW,
): { deps: Deps; call: Call; handler: RequestHandler } {
  const deps = createDeps({ ...BASE_CONFIG, ...overrides }, now)
  const handler = createHandler(deps)
  return { deps, call: (method, path, init) => handler(buildRequest(method, path, init)), handler }
}

export const readJson = <T>(response: Response): Promise<T> => response.json() as Promise<T>

export const alpacaCall =
  (call: Call): Call =>
  (method, path, init = {}) =>
    call(method, path, { ...init, headers: { ...ALPACA_HEADERS, ...init.headers } })

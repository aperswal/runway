import { z } from 'zod'
import { InvalidJsonError, STATUS } from './errors.ts'

export type MockRequest = {
  method: string
  path: string
  query: URLSearchParams
  headers: Headers
  body: unknown
  bytes: Uint8Array
  origin: string
}

type UploadedFile = { name: string; type: string; size: number }

export type RouteParams = Record<string, string>
export type Handler = (request: MockRequest) => Response
export type Route = {
  method: string
  pattern: string
  handle: (request: MockRequest, params: RouteParams) => Response
}

const JSON_HEADERS = { 'content-type': 'application/json' }

export const json = (
  body: unknown,
  status: number = STATUS.ok,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } })

export const empty = (status: number, headers: Record<string, string> = {}): Response =>
  new Response(null, { status, headers })

const PARAM_SEGMENT = /:([A-Za-z]+)/g

export function matchPath(pattern: string, path: string): RouteParams | null {
  const source = pattern.replaceAll(PARAM_SEGMENT, '(?<$1>[^/]+)')
  const match = new RegExp(`^${source}$`).exec(path)
  if (match === null) {
    return null
  }
  const groups = Object.entries(match.groups ?? {})
  return Object.fromEntries(groups.map(([name, value]) => [name, decodeURIComponent(value)]))
}

export const param = (params: RouteParams, name: string): string => params[name] ?? ''

export function dispatch(
  routes: Route[],
  request: MockRequest,
  notFound: () => Response,
): Response {
  for (const route of routes) {
    if (route.method !== request.method) {
      continue
    }
    const params = matchPath(route.pattern, request.path)
    if (params !== null) {
      return route.handle(request, params)
    }
  }
  return notFound()
}

const BINARY_TYPES = ['multipart/form-data', 'application/octet-stream']

export async function toMockRequest(request: Request, path: string): Promise<MockRequest> {
  const url = new URL(request.url)
  const type = String(request.headers.get('content-type'))
  const bytes = new Uint8Array(await request.arrayBuffer())
  return {
    method: request.method,
    path,
    query: url.searchParams,
    headers: request.headers,
    body: parseBody(type, bytes),
    bytes,
    origin: url.origin,
  }
}

const PART = (boundary: string): RegExp =>
  new RegExp(
    `Content-Disposition: form-data; ([^\\r\\n]*)\\r\\n(?:Content-Type: ([^\\r\\n]*)\\r\\n)?\\r\\n([\\s\\S]*?)\\r\\n--${boundary}`,
    'gi',
  )
const attr = (attrs: string, name: string): string | null =>
  new RegExp(`(?:^|; )${name}="([^"]*)"`).exec(attrs)?.[1] ?? null

const partValue = (match: RegExpExecArray): [string, string | UploadedFile] | null => {
  const attrs = String(match[1])
  const value = String(match[3])
  const name = attr(attrs, 'name')
  const filename = attr(attrs, 'filename')
  if (name === null) {
    return null
  }
  if (filename === null) {
    return [name, value]
  }
  const type = match[2] ?? 'application/octet-stream'
  return [name, { name: filename, type, size: value.length }]
}

function parseMultipart(text: string, type: string): Record<string, string | UploadedFile> {
  const boundary = type.slice(type.indexOf('boundary=') + 'boundary='.length)
  const parts = [...text.matchAll(PART(boundary))].map(partValue)
  return Object.fromEntries(parts.filter((p) => p !== null))
}

function parseBody(type: string, bytes: Uint8Array): unknown {
  const text = new TextDecoder('latin1').decode(bytes)
  if (type.startsWith('multipart/form-data')) {
    return parseMultipart(text, type)
  }
  if (bytes.length === 0 || BINARY_TYPES.some((t) => type.startsWith(t))) {
    return undefined
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    throw new InvalidJsonError()
  }
}

export const headerPresent = (headers: Headers, name: string): boolean => {
  const value = headers.get(name)
  return value !== null && value.length > 0
}

const BEARER = /^Bearer\s+(\S+)$/i
const bearerHeader = z.string().transform((value) => BEARER.exec(value)?.[1] ?? null)

export const bearerToken = (headers: Headers): string | null =>
  bearerHeader.safeParse(headers.get('authorization')).data ?? null

export const symbolsQuery = (request: MockRequest): string[] =>
  (request.query.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

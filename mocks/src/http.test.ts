import { describe, expect, it } from 'vitest'
import { InvalidJsonError } from './errors.ts'
import {
  bearerToken,
  dispatch,
  empty,
  headerPresent,
  json,
  matchPath,
  param,
  symbolsQuery,
  toMockRequest,
  type MockRequest,
} from './http.ts'

const request = (method: string, path: string, query = ''): MockRequest => ({
  method,
  path,
  query: new URLSearchParams(query),
  headers: new Headers(),
  body: undefined,
  bytes: new Uint8Array(),
  origin: 'http://h',
})

describe('matchPath', () => {
  it('matches literal segments', () => {
    expect(matchPath('/v2/account', '/v2/account')).toEqual({})
  })

  it('captures and decodes params', () => {
    expect(matchPath('/v2/assets/:symbol', '/v2/assets/BTC%2FUSD')).toEqual({ symbol: 'BTC/USD' })
    expect(matchPath('/a/:x/b/:y', '/a/1/b/2')).toEqual({ x: '1', y: '2' })
  })

  it('rejects different lengths and mismatched segments', () => {
    expect(matchPath('/v2/account', '/v2/account/x')).toBeNull()
    expect(matchPath('/v2/account', '/x/v2/account')).toBeNull()
    expect(matchPath('/v2/account', '/v2/clock')).toBeNull()
    expect(matchPath('/v2/assets/:symbol', '/v2/assets/')).toBeNull()
    expect(matchPath('/v2/assets/:symbol', '/v2/assets/a/b')).toBeNull()
  })

  it('reads params with an empty fallback', () => {
    expect(param({ id: '7' }, 'id')).toBe('7')
    expect(param({}, 'id')).toBe('')
  })
})

describe('dispatch', () => {
  const routes = [
    { method: 'GET', pattern: '/a', handle: () => json({ route: 'a' }) },
    {
      method: 'POST',
      pattern: '/b/:id',
      handle: (_r: MockRequest, p: Record<string, string>) => json(p),
    },
  ]
  const notFound = () => empty(404)

  it('routes by method and pattern', async () => {
    expect(await dispatch(routes, request('POST', '/b/7'), notFound).json()).toEqual({ id: '7' })
    expect(await dispatch(routes, request('GET', '/a'), notFound).json()).toEqual({ route: 'a' })
  })

  it('falls back when method or path does not match', () => {
    expect(dispatch(routes, request('POST', '/a'), notFound).status).toBe(404)
    expect(dispatch(routes, request('GET', '/zzz'), notFound).status).toBe(404)
    expect(dispatch([], request('GET', '/a'), notFound).status).toBe(404)
  })
})

describe('toMockRequest', () => {
  it('parses query and json body', async () => {
    const req = new Request('http://h/alpaca/v2/orders?x=1', { method: 'POST', body: '{"a":1}' })
    const mock = await toMockRequest(req, '/v2/orders')
    expect(mock.method).toBe('POST')
    expect(mock.path).toBe('/v2/orders')
    expect(mock.query.get('x')).toBe('1')
    expect(mock.body).toEqual({ a: 1 })
    expect(mock.headers).toBe(req.headers)
    expect(mock.origin).toBe('http://h')
  })

  it('leaves the body undefined when empty', async () => {
    const mock = await toMockRequest(new Request('http://h/x'), '/x')
    expect(mock.body).toBeUndefined()
  })

  it('summarizes multipart form fields and keeps binary bodies as bytes', async () => {
    const form = new FormData()
    form.set('media', new Blob([new Uint8Array(4)], { type: 'image/png' }), 'c.png')
    form.set('media_category', 'tweet_image')
    const multipart = await toMockRequest(
      new Request('http://h/x', { method: 'POST', body: form }),
      '/x',
    )
    expect(multipart.body).toEqual({
      media: { name: 'c.png', type: 'image/png', size: 4 },
      media_category: 'tweet_image',
    })
    const binary = await toMockRequest(
      new Request('http://h/x', {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream; x=1' },
        body: new Uint8Array([1, 2]),
      }),
      '/x',
    )
    expect(binary.body).toBeUndefined()
    expect(binary.bytes).toEqual(new Uint8Array([1, 2]))
  })

  it('skips malformed multipart parts and defaults a file type', async () => {
    const body = [
      '--b\r\nContent-Disposition: form-data; filename="only"\r\n\r\nx\r\n',
      '--b\r\nContent-Disposition: form-data; filename="a.bin"; name="f"\r\n\r\nzz\r\n',
      '--b\r\nContent-Disposition: form-data; name="g"\r\n',
      '--b\r\nContent-Disposition: form-data; name="t"\r\n\r\nsee filename="x" here\r\n',
      '--b\r\nbroken\r\n',
      '--b--\r\n',
    ].join('')
    const mock = await toMockRequest(
      new Request('http://h/x', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=b' },
        body,
      }),
      '/x',
    )
    expect(mock.body).toEqual({
      f: { name: 'a.bin', type: 'application/octet-stream', size: 2 },
      t: 'see filename="x" here',
    })
  })

  it('throws on invalid json', async () => {
    const req = new Request('http://h/x', { method: 'POST', body: '{nope' })
    await expect(toMockRequest(req, '/x')).rejects.toThrow(InvalidJsonError)
  })
})

describe('header helpers', () => {
  it('detects non-empty headers', () => {
    expect(headerPresent(new Headers({ a: 'x' }), 'a')).toBe(true)
    expect(headerPresent(new Headers({ a: '  ' }), 'a')).toBe(false)
    expect(headerPresent(new Headers({ a: '' }), 'a')).toBe(false)
    expect(headerPresent(new Headers(), 'a')).toBe(false)
  })

  it('extracts bearer tokens', () => {
    expect(bearerToken(new Headers({ authorization: 'Bearer abc' }))).toBe('abc')
    expect(bearerToken(new Headers({ authorization: 'bearer abc' }))).toBe('abc')
    expect(bearerToken(new Headers({ authorization: 'Bearer   abc' }))).toBe('abc')
    expect(bearerToken(new Headers({ authorization: 'Bearer abc def' }))).toBeNull()
    expect(bearerToken(new Headers({ authorization: 'x Bearer abc' }))).toBeNull()
    expect(bearerToken(new Headers({ authorization: 'Bearer' }))).toBeNull()
    expect(bearerToken(new Headers({ authorization: 'Basic abc' }))).toBeNull()
    expect(bearerToken(new Headers({ 'x-authorization': 'Bearer abc' }))).toBeNull()
    expect(bearerToken(new Headers())).toBeNull()
  })

  it('splits the symbols query', () => {
    expect(symbolsQuery(request('GET', '/', 'symbols=AAPL,%20MSFT,,'))).toEqual(['AAPL', 'MSFT'])
    expect(symbolsQuery(request('GET', '/', 'symbols='))).toEqual([])
    expect(symbolsQuery(request('GET', '/'))).toEqual([])
  })
})

describe('responses', () => {
  it('builds json and empty responses with extra headers', async () => {
    const res = json({ ok: true }, 201, { 'x-extra': '1' })
    expect(res.status).toBe(201)
    expect(res.headers.get('x-extra')).toBe('1')
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.text()).toBe('{"ok":true}')
    expect(json({}).status).toBe(200)
    expect(json({}).headers.get('content-type')).toBe('application/json')
    const none = empty(204, { 'x-id': 'a' })
    expect(none.status).toBe(204)
    expect(none.headers.get('x-id')).toBe('a')
    expect(await none.text()).toBe('')
    expect(empty(204).status).toBe(204)
  })
})

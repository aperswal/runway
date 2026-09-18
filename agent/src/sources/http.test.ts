import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { HttpError, SourceError } from '../errors.ts'
import { fetchJson, fetchText, parseJson, parseShape, withQuery } from './http.ts'

afterEach(() => vi.unstubAllGlobals())

describe('fetchText', () => {
  it('returns the body and forwards init', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('hello'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchText('https://x.test/a', { method: 'POST' })).resolves.toBe('hello')
    expect(fetchMock).toHaveBeenCalledWith('https://x.test/a', { method: 'POST' })
  })
  it('throws HttpError with status, url and body on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 503 })))
    const error = await fetchText('https://x.test/a').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(HttpError)
    expect(error).toMatchObject({ status: 503, url: 'https://x.test/a' })
    expect((error as Error).message).toBe('https://x.test/a responded 503: nope')
  })
})

describe('fetchJson', () => {
  it('parses the body with the schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"n":1}')))
    await expect(fetchJson('https://x.test', z.object({ n: z.number() }))).resolves.toEqual({
      n: 1,
    })
  })
})

describe('parseJson', () => {
  it('rejects invalid JSON', () =>
    expect(() => parseJson(z.unknown(), '{', '--input')).toThrow(
      new SourceError('--input is not valid JSON'),
    ))
})

describe('parseShape', () => {
  it('names the failing path', () =>
    expect(() =>
      parseShape(z.object({ a: z.object({ b: z.string() }) }), { a: {} }, 'api'),
    ).toThrow(/api has an unexpected shape: a\.b /))
  it('lists every issue', () =>
    expect(() => parseShape(z.object({ a: z.string(), b: z.number() }), {}, 'api')).toThrow(
      /^api has an unexpected shape: a [^;]+; b [^;]+$/,
    ))
})

describe('withQuery', () => {
  it('encodes parameters', () =>
    expect(withQuery('https://x.test/p', { q: 'a b&c' })).toBe('https://x.test/p?q=a+b%26c'))
})

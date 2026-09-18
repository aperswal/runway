import { afterEach, describe, expect, it, vi } from 'vitest'
import { MissingEnvError, SourceError } from '../errors.ts'
import { apify, selectorFunction } from './apify.ts'
import type { Command } from './source.ts'

const run: Command['run'] = (flags, keys) => apify.commands[0]!.run(flags, keys)
const keys = { APIFY_TOKEN: 'tok' }

afterEach(() => vi.unstubAllGlobals())

describe('apify run', () => {
  it('posts the input to the sync dataset endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[{"a":1},{"a":2}]'))
    vi.stubGlobal('fetch', fetchMock)
    const flags = { actor: 'clockworks/tiktok-scraper', input: '{"hashtags":["nvda"]}' }
    await expect(run(flags, keys)).resolves.toEqual({
      actor: 'clockworks~tiktok-scraper',
      count: 2,
      items: [{ a: 1 }, { a: 2 }],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?timeout=300',
      {
        method: 'POST',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: '{"hashtags":["nvda"]}',
      },
    )
  })
  it('passes a custom timeout', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]'))
    vi.stubGlobal('fetch', fetchMock)
    await run({ actor: 'a~b', input: '{}', timeout: '60' }, keys)
    expect(fetchMock.mock.calls[0]![0]).toContain('?timeout=60')
  })
  it('names the missing token', async () => {
    await expect(run({ actor: 'a', input: '{}' }, {})).rejects.toThrow(
      new MissingEnvError('APIFY_TOKEN'),
    )
  })
  it('rejects malformed input JSON', async () => {
    await expect(run({ actor: 'a', input: '{oops' }, keys)).rejects.toThrow(
      new SourceError('--input is not valid JSON'),
    )
  })
})

describe('apify scrape', () => {
  const scrape = apify.commands.find((c) => c.name === 'scrape')?.run
  it('runs the cheerio scraper with a selector page function over the urls', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('[{"url":"https://a.test","items":["x"]}]'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      scrape?.({ urls: 'https://a.test, https://b.test,', selector: 'h2', max: '3' }, keys),
    ).resolves.toEqual({
      actor: 'apify~cheerio-scraper',
      count: 1,
      items: [{ url: 'https://a.test', items: ['x'] }],
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      'https://api.apify.com/v2/acts/apify~cheerio-scraper/run-sync-get-dataset-items?timeout=300',
    )
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body.startUrls).toEqual([{ url: 'https://a.test' }, { url: 'https://b.test' }])
    expect(body.maxRequestsPerCrawl).toBe(3)
    expect(body.pageFunction).toBe(selectorFunction('h2'))
    expect(body.proxyConfiguration).toEqual({ useApifyProxy: true })
  })
  it('uses a custom page function and defaults the selector and page cap', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response('[]')))
    vi.stubGlobal('fetch', fetchMock)
    const bodyOf = (call: number): Record<string, unknown> =>
      JSON.parse((fetchMock.mock.calls[call] as [string, RequestInit])[1].body as string) as Record<
        string,
        unknown
      >
    await scrape?.(
      { urls: 'https://a.test', 'page-function': 'async function pageFunction() {}' },
      keys,
    )
    expect(bodyOf(0).pageFunction).toBe('async function pageFunction() {}')
    expect(bodyOf(0).maxRequestsPerCrawl).toBe(20)
    await scrape?.({ urls: 'https://a.test' }, keys)
    expect(bodyOf(1).pageFunction).toBe(selectorFunction(undefined))
    expect(selectorFunction(undefined)).toContain('$("body")')
    expect(selectorFunction('a.x')).toContain('$("a.x")')
  })
  it('needs urls and a token', async () => {
    await expect(scrape?.({}, keys)).rejects.toThrow()
    await expect(scrape?.({ urls: 'https://a.test' }, {})).rejects.toThrow(
      new MissingEnvError('APIFY_TOKEN'),
    )
  })
})

describe('apify search and schema', () => {
  const search: Command['run'] = (flags, k) => apify.commands[1]!.run(flags, k)
  const schema: Command['run'] = (flags, k) => apify.commands[2]!.run(flags, k)
  it('searches the store by popularity and trims descriptions', async () => {
    const body = JSON.stringify({
      data: {
        items: [
          {
            username: 'trudax',
            name: 'reddit-scraper-lite',
            title: 'Reddit Scraper Lite',
            description: 'x'.repeat(200),
            pricingModel: 'FREE',
            stats: { totalUsers30Days: 7129 },
          },
          { username: 'a', name: 'b' },
        ],
      },
    })
    const fetchMock = vi.fn((_url: string) => Promise.resolve(new Response(body)))
    vi.stubGlobal('fetch', fetchMock)
    await expect(search({ q: 'reddit posts', max: '2' }, keys)).resolves.toEqual({
      query: 'reddit posts',
      actors: [
        {
          actor: 'trudax/reddit-scraper-lite',
          title: 'Reddit Scraper Lite',
          users30d: 7129,
          pricing: 'FREE',
          description: 'x'.repeat(160),
        },
        { actor: 'a/b', title: 'b', users30d: 0, pricing: 'unknown', description: '' },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apify.com/v2/store?search=reddit%20posts&limit=2&sortBy=popularity',
      { headers: { authorization: 'Bearer tok' } },
    )
    await search({ q: 'x' }, keys)
    expect(fetchMock.mock.calls[1]![0]).toContain('&limit=10&')
    await expect(search({ q: 'x' }, {})).rejects.toThrow(new MissingEnvError('APIFY_TOKEN'))
  })
  it('reads the default build input schema, with prefill and enum fallbacks', async () => {
    const inputSchema = JSON.stringify({
      required: ['searches'],
      properties: {
        searches: { type: 'array', description: 'terms', prefill: ['a'] },
        sort: { type: 'string', default: 'new', enum: ['new', 'hot'] },
        bare: {},
      },
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ data: { inputSchema } })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(schema({ actor: 'trudax/reddit-scraper-lite' }, keys)).resolves.toEqual({
      actor: 'trudax~reddit-scraper-lite',
      required: ['searches'],
      inputs: [
        { name: 'searches', type: 'array', description: 'terms', default: ['a'], options: [] },
        { name: 'sort', type: 'string', description: '', default: 'new', options: ['new', 'hot'] },
        { name: 'bare', type: 'unknown', description: '', default: null, options: [] },
      ],
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.apify.com/v2/acts/trudax~reddit-scraper-lite/builds/default',
      { headers: { authorization: 'Bearer tok' } },
    )
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }))))
    await expect(schema({ actor: 'a~b' }, keys)).resolves.toEqual({
      actor: 'a~b',
      required: [],
      inputs: [],
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: { inputSchema: '{"required":["x"]}' } })),
        ),
    )
    await expect(schema({ actor: 'a~b' }, keys)).resolves.toEqual({
      actor: 'a~b',
      required: ['x'],
      inputs: [],
    })
    await expect(schema({ actor: 'a' }, {})).rejects.toThrow(new MissingEnvError('APIFY_TOKEN'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { inputSchema: '{' } }))),
    )
    await expect(schema({ actor: 'a~b' }, keys)).rejects.toThrow(
      new SourceError('input schema is not valid JSON'),
    )
  })
})

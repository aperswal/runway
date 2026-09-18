import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceError } from '../errors.ts'
import { lesswrong } from './lesswrong.ts'
import type { Command } from './source.ts'

const recent: Command['run'] = (flags, keys) => lesswrong.commands[0]!.run(flags, keys)
const search: Command['run'] = (flags, keys) => lesswrong.commands[1]!.run(flags, keys)

const headers = {
  'content-type': 'application/json',
  'user-agent': 'runway adityaperswal@gmail.com',
}
const recentQuery = `query Recent($limit: Int) {
  posts(input: { terms: { view: "new", limit: $limit } }) {
    results { title pageUrl postedAt user { displayName } htmlBody }
  }
}`
const posts = (results: unknown[]) => ({ data: { posts: { results } } })

afterEach(() => vi.unstubAllGlobals())

describe('lesswrong recent', () => {
  it('queries GraphQL and maps posts', async () => {
    const body = posts([
      {
        title: 'A',
        pageUrl: 'https://www.lesswrong.com/posts/a',
        postedAt: '2026-01-01T00:00:00Z',
        user: { displayName: 'Eliezer' },
        htmlBody: `<p>Hello <b>world</b> ${'x'.repeat(1200)}</p>`,
      },
      {
        title: 'B',
        pageUrl: 'https://www.lesswrong.com/posts/b',
        postedAt: '2026-01-02T00:00:00Z',
        user: null,
        htmlBody: null,
      },
    ])
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))
    vi.stubGlobal('fetch', fetchMock)
    await expect(recent({ max: '2' }, {})).resolves.toEqual([
      {
        title: 'A',
        url: 'https://www.lesswrong.com/posts/a',
        author: 'Eliezer',
        postedAt: '2026-01-01T00:00:00Z',
        excerpt: `Hello world ${'x'.repeat(1200)}`.slice(0, 1000),
      },
      {
        title: 'B',
        url: 'https://www.lesswrong.com/posts/b',
        author: '',
        postedAt: '2026-01-02T00:00:00Z',
        excerpt: '',
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith('https://www.lesswrong.com/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: recentQuery, variables: { limit: 2 } }),
    })
  })
  it('surfaces GraphQL errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('{"errors":[{"message":"bad query"},{"message":"and worse"}]}'),
        ),
    )
    await expect(recent({}, {})).rejects.toThrow(
      new SourceError('LessWrong GraphQL failed: bad query; and worse'),
    )
  })
  it('fails on errors even when partial data came back', async () => {
    const body = { errors: [{ message: 'partial' }], ...posts([]) }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))
    await expect(recent({}, {})).rejects.toThrow(
      new SourceError('LessWrong GraphQL failed: partial'),
    )
  })
  it('fails when data is null without errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"data":null}')))
    await expect(recent({}, {})).rejects.toThrow(new SourceError('LessWrong GraphQL failed: '))
  })
  it('fails when data is missing without errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    await expect(recent({}, {})).rejects.toThrow(new SourceError('LessWrong GraphQL failed: '))
  })
})

describe('lesswrong search', () => {
  it('posts to the search endpoint and maps hits', async () => {
    const hits = [
      {
        objectID: 'abc',
        title: 'Scaling',
        slug: 'scaling',
        postedAt: '2022-04-01T20:41:17Z',
        authorDisplayName: '1a3orn',
        body: 'x'.repeat(1200),
      },
      {
        objectID: 'def',
        title: 'Other',
        slug: 'other',
        postedAt: '2022-05-01T20:41:17Z',
        authorDisplayName: null,
        body: null,
      },
    ]
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ hits }])))
    vi.stubGlobal('fetch', fetchMock)
    const result = await search({ q: 'scaling laws', max: '5' }, {})
    expect(result).toEqual([
      {
        title: 'Scaling',
        url: 'https://www.lesswrong.com/posts/abc/scaling',
        author: '1a3orn',
        postedAt: '2022-04-01T20:41:17Z',
        excerpt: 'x'.repeat(1000),
      },
      {
        title: 'Other',
        url: 'https://www.lesswrong.com/posts/def/other',
        author: '',
        postedAt: '2022-05-01T20:41:17Z',
        excerpt: '',
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith('https://www.lesswrong.com/api/search', {
      method: 'POST',
      headers,
      body: JSON.stringify([
        { indexName: 'posts', params: { query: 'scaling laws', hitsPerPage: 5 } },
      ]),
    })
  })
})

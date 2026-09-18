import { afterEach, describe, expect, it, vi } from 'vitest'
import { hn } from './hn.ts'
import type { Command } from './source.ts'

const run: Command['run'] = (flags, keys) => hn.commands[0]!.run(flags, keys)

const story = {
  objectID: '1',
  title: 'Nvidia earnings',
  url: 'https://example.com/e',
  author: 'pg',
  points: 120,
  num_comments: 40,
  created_at: '2026-08-01T00:00:00Z',
  story_text: '<p>Hello &amp; welcome</p>',
}
const comment = {
  objectID: '2',
  title: null,
  story_title: 'Parent story',
  url: null,
  author: 'dang',
  points: null,
  num_comments: null,
  created_at: '2026-08-02T00:00:00Z',
  comment_text: 'Nice <i>one</i>',
}
const bareStory = {
  objectID: '3',
  title: null,
  url: null,
  author: 'x',
  points: 0,
  num_comments: 0,
  created_at: '2026-08-03T00:00:00Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('hn search', () => {
  it('maps stories and comments', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ hits: [story, comment, bareStory] })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(run({ q: 'nvidia' }, {})).resolves.toEqual([
      {
        id: '1',
        type: 'story',
        title: 'Nvidia earnings',
        text: 'Hello & welcome',
        url: 'https://example.com/e',
        hnUrl: 'https://news.ycombinator.com/item?id=1',
        author: 'pg',
        points: 120,
        comments: 40,
        createdAt: '2026-08-01T00:00:00Z',
      },
      {
        id: '2',
        type: 'comment',
        title: 'Parent story',
        text: 'Nice one',
        url: 'https://news.ycombinator.com/item?id=2',
        hnUrl: 'https://news.ycombinator.com/item?id=2',
        author: 'dang',
        points: 0,
        comments: 0,
        createdAt: '2026-08-02T00:00:00Z',
      },
      {
        id: '3',
        type: 'story',
        title: '',
        text: '',
        url: 'https://news.ycombinator.com/item?id=3',
        hnUrl: 'https://news.ycombinator.com/item?id=3',
        author: 'x',
        points: 0,
        comments: 0,
        createdAt: '2026-08-03T00:00:00Z',
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hn.algolia.com/api/v1/search?query=nvidia&hitsPerPage=25',
      undefined,
    )
  })
  it('handles a comment without a story title', async () => {
    const orphan = { ...comment, objectID: '4', story_title: undefined }
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ hits: [orphan] }))),
    )
    await expect(run({ q: 'x' }, {})).resolves.toMatchObject([
      { id: '4', type: 'comment', title: '' },
    ])
  })
  it('forwards tags and max', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"hits":[]}'))
    vi.stubGlobal('fetch', fetchMock)
    await run({ q: 'ai', max: '3', tags: 'story' }, {})
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://hn.algolia.com/api/v1/search?query=ai&hitsPerPage=3&tags=story',
    )
  })
})

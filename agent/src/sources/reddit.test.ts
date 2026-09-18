import { afterEach, describe, expect, it, vi } from 'vitest'
import { MissingEnvError, SourceError } from '../errors.ts'
import type { RedditThread } from './reddit.ts'
import { reddit } from './reddit.ts'
import type { Command } from './source.ts'

const search: Command['run'] = (flags, keys) => reddit.commands[0]!.run(flags, keys)
const thread: Command['run'] = (flags, keys) => reddit.commands[1]!.run(flags, keys)
const keys = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'secret' }
const userAgent = 'runway:research:1.0 (contact adityaperswal@gmail.com)'

const post = {
  id: 'p1',
  title: 'NVDA to the moon',
  author: 'ape',
  subreddit: 'wallstreetbets',
  score: 10,
  num_comments: 3,
  created_utc: 1700000000,
  permalink: '/r/wallstreetbets/comments/p1/nvda/',
  url: 'https://i.redd.it/x.png',
  selftext: 'yolo',
}
const mappedPost = {
  id: 'p1',
  title: 'NVDA to the moon',
  author: 'ape',
  subreddit: 'wallstreetbets',
  score: 10,
  comments: 3,
  createdAt: '2023-11-14T22:13:20.000Z',
  url: 'https://www.reddit.com/r/wallstreetbets/comments/p1/nvda/',
  link: 'https://i.redd.it/x.png',
  text: 'yolo',
}
const listing = (children: unknown[]) => ({ data: { children } })
const token = () => new Response('{"access_token":"abc"}')
const json = (body: unknown) => new Response(JSON.stringify(body))

const stub = (...responses: Response[]) => {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('reddit search', () => {
  it('gets a token then searches site wide', async () => {
    const fetchMock = stub(token(), json(listing([{ data: post }])))
    await expect(search({ q: 'nvda' }, keys)).resolves.toEqual([mappedPost])
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from('id:secret').toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': userAgent,
      },
      body: 'grant_type=client_credentials',
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://oauth.reddit.com/search?q=nvda&limit=25&sort=relevance&restrict_sr=1&raw_json=1',
      { headers: { authorization: 'Bearer abc', 'user-agent': userAgent } },
    )
  })
  it('scopes to a subreddit with sort and max', async () => {
    const fetchMock = stub(token(), json(listing([])))
    await expect(
      search({ q: 'nvda', sub: 'stocks', sort: 'new', max: '5' }, keys),
    ).resolves.toEqual([])
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://oauth.reddit.com/r/stocks/search?q=nvda&limit=5&sort=new&restrict_sr=1&raw_json=1',
    )
  })
  it('names the missing client id', async () => {
    await expect(search({ q: 'x' }, {})).rejects.toThrow(new MissingEnvError('REDDIT_CLIENT_ID'))
  })
  it('names the missing client secret', async () => {
    await expect(search({ q: 'x' }, { REDDIT_CLIENT_ID: 'id' })).rejects.toThrow(
      new MissingEnvError('REDDIT_CLIENT_SECRET'),
    )
  })
})

describe('reddit thread', () => {
  const comment = (author: string, body: string, replies?: unknown) => ({
    kind: 't1',
    data: {
      author,
      body,
      score: 1,
      created_utc: 1700000000,
      ...(replies === undefined ? {} : { replies }),
    },
  })
  const tree = [
    listing([{ data: post }]),
    listing([
      comment('a', 'top', listing([comment('b', 'child', ''), { kind: 'more', data: {} }])),
      comment('c', 'second'),
    ]),
  ]
  it('flattens the comment tree with depth', async () => {
    const fetchMock = stub(token(), json(tree))
    await expect(thread({ id: 'p1' }, keys)).resolves.toEqual({
      post: mappedPost,
      comments: [
        { author: 'a', body: 'top', score: 1, createdAt: '2023-11-14T22:13:20.000Z', depth: 0 },
        { author: 'b', body: 'child', score: 1, createdAt: '2023-11-14T22:13:20.000Z', depth: 1 },
        { author: 'c', body: 'second', score: 1, createdAt: '2023-11-14T22:13:20.000Z', depth: 0 },
      ],
    })
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://oauth.reddit.com/comments/p1?limit=100&raw_json=1',
    )
  })
  it('stops at max comments', async () => {
    stub(token(), json(tree))
    const result = (await thread({ id: 'p1', max: '2' }, keys)) as RedditThread
    expect(result.comments.map((c) => c.author)).toEqual(['a', 'b'])
  })
  it('names a malformed comment', async () => {
    stub(
      token(),
      json([listing([{ data: post }]), listing([{ kind: 't1', data: { author: 'a' } }])]),
    )
    await expect(thread({ id: 'p1' }, keys)).rejects.toThrow(
      /^reddit comment has an unexpected shape: body /,
    )
  })
  it('fails when the post is missing', async () => {
    stub(token(), json([listing([]), listing([])]))
    await expect(thread({ id: 'zzz' }, keys)).rejects.toThrow(
      new SourceError('Reddit post zzz not found'),
    )
  })
})

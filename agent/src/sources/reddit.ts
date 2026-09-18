import { z } from 'zod'
import type { SourceKeys } from '../env.ts'
import { requireKey } from '../env.ts'
import { SourceError } from '../errors.ts'
import type { Flags } from './args.ts'
import { intFlag, requireFlag } from './args.ts'
import { fetchJson, parseShape, withQuery } from './http.ts'
import type { Source } from './source.ts'

const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token'
const API_URL = 'https://oauth.reddit.com'
const SITE_URL = 'https://www.reddit.com'
const USER_AGENT = 'runway:research:1.0 (contact adityaperswal@gmail.com)'
const DEFAULT_SEARCH_MAX = 25
const DEFAULT_THREAD_MAX = 100
const MS_PER_SECOND = 1000
const COMMENT_KIND = 't1'

const tokenSchema = z.object({ access_token: z.string() })

const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  subreddit: z.string(),
  score: z.number(),
  num_comments: z.number(),
  created_utc: z.number(),
  permalink: z.string(),
  url: z.string(),
  selftext: z.string(),
})

const childrenSchema = z.object({
  data: z.object({ children: z.array(z.object({ kind: z.string(), data: z.unknown() })) }),
})
type Children = z.infer<typeof childrenSchema>

const commentSchema = z.object({
  author: z.string(),
  body: z.string(),
  score: z.number(),
  created_utc: z.number(),
  replies: z.union([z.literal(''), childrenSchema]).optional(),
})

const searchSchema = z.object({
  data: z.object({ children: z.array(z.object({ data: postSchema })) }),
})
const threadSchema = z.tuple([searchSchema, childrenSchema])

type RedditPost = {
  id: string
  title: string
  author: string
  subreddit: string
  score: number
  comments: number
  createdAt: string
  url: string
  link: string
  text: string
}

type RedditComment = {
  author: string
  body: string
  score: number
  createdAt: string
  depth: number
}

export type RedditThread = { post: RedditPost; comments: RedditComment[] }

const isoDate = (seconds: number): string => new Date(seconds * MS_PER_SECOND).toISOString()

const toPost = (post: z.infer<typeof postSchema>): RedditPost => ({
  id: post.id,
  title: post.title,
  author: post.author,
  subreddit: post.subreddit,
  score: post.score,
  comments: post.num_comments,
  createdAt: isoDate(post.created_utc),
  url: `${SITE_URL}${post.permalink}`,
  link: post.url,
  text: post.selftext,
})

async function accessToken(keys: SourceKeys): Promise<string> {
  const id = requireKey(keys, 'REDDIT_CLIENT_ID')
  const secret = requireKey(keys, 'REDDIT_CLIENT_SECRET')
  const basic = Buffer.from(`${id}:${secret}`).toString('base64')
  const result = await fetchJson(TOKEN_URL, tokenSchema, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
  })
  return result.access_token
}

async function api<T>(
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  keys: SourceKeys,
): Promise<T> {
  const token = await accessToken(keys)
  return fetchJson(withQuery(`${API_URL}${path}`, params), schema, {
    headers: { authorization: `Bearer ${token}`, 'user-agent': USER_AGENT },
  })
}

async function search(flags: Flags, keys: SourceKeys): Promise<RedditPost[]> {
  const sub = flags.sub
  const path = sub === undefined ? '/search' : `/r/${encodeURIComponent(sub)}/search`
  const params = {
    q: requireFlag(flags, 'q'),
    limit: String(intFlag(flags, 'max', DEFAULT_SEARCH_MAX)),
    sort: flags.sort ?? 'relevance',
    restrict_sr: '1',
    raw_json: '1',
  }
  const result = await api(path, params, searchSchema, keys)
  return result.data.children.map((child) => toPost(child.data))
}

function flattenComments(
  listing: Children,
  depth: number,
  out: RedditComment[],
  max: number,
): void {
  for (const child of listing.data.children) {
    if (child.kind !== COMMENT_KIND || out.length >= max) {
      continue
    }
    const comment = parseShape(commentSchema, child.data, 'reddit comment')
    out.push({
      author: comment.author,
      body: comment.body,
      score: comment.score,
      createdAt: isoDate(comment.created_utc),
      depth,
    })
    if (typeof comment.replies === 'object') {
      flattenComments(comment.replies, depth + 1, out, max)
    }
  }
}

async function thread(flags: Flags, keys: SourceKeys): Promise<RedditThread> {
  const id = requireFlag(flags, 'id')
  const max = intFlag(flags, 'max', DEFAULT_THREAD_MAX)
  const params = { limit: String(max), raw_json: '1' }
  const [posts, commentListing] = await api(
    `/comments/${encodeURIComponent(id)}`,
    params,
    threadSchema,
    keys,
  )
  const post = posts.data.children[0]?.data
  if (post === undefined) {
    throw new SourceError(`Reddit post ${id} not found`)
  }
  const comments: RedditComment[] = []
  flattenComments(commentListing, 0, comments, max)
  return { post: toPost(post), comments }
}

export const reddit: Source = {
  name: 'reddit',
  commands: [
    {
      name: 'search',
      usage:
        'reddit search --q "<query>" [--sub wallstreetbets] [--max 25] [--sort relevance|new|top]',
      about: 'search Reddit posts, optionally within one subreddit',
      run: search,
    },
    {
      name: 'thread',
      usage: 'reddit thread --id <postId> [--max 100]',
      about: 'a post with its comment tree flattened (depth per comment)',
      run: thread,
    },
  ],
}

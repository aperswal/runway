import { z } from 'zod'
import { SourceError } from '../errors.ts'
import { intFlag, requireFlag } from './args.ts'
import { fetchJson } from './http.ts'
import type { Source } from './source.ts'
import { stripHtml } from './text.ts'

const GRAPHQL_URL = 'https://www.lesswrong.com/graphql'
const SEARCH_URL = 'https://www.lesswrong.com/api/search'
const POST_URL = 'https://www.lesswrong.com/posts'
const USER_AGENT = 'runway adityaperswal@gmail.com'
const DEFAULT_MAX = 20
const EXCERPT_CHARS = 1000

const RECENT_QUERY = `query Recent($limit: Int) {
  posts(input: { terms: { view: "new", limit: $limit } }) {
    results { title pageUrl postedAt user { displayName } htmlBody }
  }
}`

const recentSchema = z.object({
  errors: z.array(z.object({ message: z.string() })).optional(),
  data: z
    .object({
      posts: z.object({
        results: z.array(
          z.object({
            title: z.string(),
            pageUrl: z.string(),
            postedAt: z.string(),
            user: z.object({ displayName: z.string() }).nullable(),
            htmlBody: z.string().nullable(),
          }),
        ),
      }),
    })
    .nullish(),
})

const searchSchema = z.tuple([
  z.object({
    hits: z.array(
      z.object({
        objectID: z.string(),
        title: z.string(),
        slug: z.string(),
        postedAt: z.string(),
        authorDisplayName: z.string().nullable(),
        body: z.string().nullable(),
      }),
    ),
  }),
])

type LessWrongPost = {
  title: string
  url: string
  author: string
  postedAt: string
  excerpt: string
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
  body: JSON.stringify(body),
})

async function recent(max: number): Promise<LessWrongPost[]> {
  const body = { query: RECENT_QUERY, variables: { limit: max } }
  const result = await fetchJson(GRAPHQL_URL, recentSchema, postJson(body))
  const errors = result.errors ?? []
  if (errors.length > 0 || result.data === undefined || result.data === null) {
    const detail = errors.map((error) => error.message).join('; ')
    throw new SourceError(`LessWrong GraphQL failed: ${detail}`)
  }
  return result.data.posts.results.map((post) => ({
    title: post.title,
    url: post.pageUrl,
    author: post.user?.displayName ?? '',
    postedAt: post.postedAt,
    excerpt: stripHtml(post.htmlBody ?? '').slice(0, EXCERPT_CHARS),
  }))
}

async function search(query: string, max: number): Promise<LessWrongPost[]> {
  const body = [{ indexName: 'posts', params: { query, hitsPerPage: max } }]
  const [result] = await fetchJson(SEARCH_URL, searchSchema, postJson(body))
  return result.hits.map((hit) => ({
    title: hit.title,
    url: `${POST_URL}/${hit.objectID}/${hit.slug}`,
    author: hit.authorDisplayName ?? '',
    postedAt: hit.postedAt,
    excerpt: (hit.body ?? '').slice(0, EXCERPT_CHARS),
  }))
}

export const lesswrong: Source = {
  name: 'lesswrong',
  commands: [
    {
      name: 'recent',
      usage: 'lesswrong recent [--max 20]',
      about: 'newest LessWrong posts with a plain-text excerpt',
      run: (flags) => recent(intFlag(flags, 'max', DEFAULT_MAX)),
    },
    {
      name: 'search',
      usage: 'lesswrong search --q "<query>" [--max 20]',
      about: 'full-text search of LessWrong posts',
      run: (flags) => search(requireFlag(flags, 'q'), intFlag(flags, 'max', DEFAULT_MAX)),
    },
  ],
}

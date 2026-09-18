import { z } from 'zod'
import type { Flags } from './args.ts'
import { intFlag, requireFlag } from './args.ts'
import { fetchJson, withQuery } from './http.ts'
import type { Source } from './source.ts'
import { stripHtml } from './text.ts'

const SEARCH_URL = 'https://hn.algolia.com/api/v1/search'
const ITEM_URL = 'https://news.ycombinator.com/item?id='
const DEFAULT_MAX = 25

const hitSchema = z.object({
  objectID: z.string(),
  title: z.string().nullish(),
  story_title: z.string().nullish(),
  url: z.string().nullish(),
  author: z.string(),
  points: z.number().nullish(),
  num_comments: z.number().nullish(),
  created_at: z.string(),
  story_text: z.string().nullish(),
  comment_text: z.string().nullish(),
})
const searchSchema = z.object({ hits: z.array(hitSchema) })

type HnHit = {
  id: string
  type: 'story' | 'comment'
  title: string
  url: string
  hnUrl: string
  author: string
  points: number
  comments: number
  createdAt: string
  text: string
}

type Hit = z.infer<typeof hitSchema>

const kindOf = (hit: Hit): Pick<HnHit, 'type' | 'title' | 'text'> =>
  typeof hit.comment_text === 'string'
    ? { type: 'comment', title: hit.story_title ?? '', text: stripHtml(hit.comment_text) }
    : { type: 'story', title: hit.title ?? '', text: stripHtml(hit.story_text ?? '') }

const toHit = (hit: Hit): HnHit => ({
  id: hit.objectID,
  ...kindOf(hit),
  url: hit.url ?? `${ITEM_URL}${hit.objectID}`,
  hnUrl: `${ITEM_URL}${hit.objectID}`,
  author: hit.author,
  points: hit.points ?? 0,
  comments: hit.num_comments ?? 0,
  createdAt: hit.created_at,
})

export const hn: Source = {
  name: 'hn',
  commands: [
    {
      name: 'search',
      usage: 'hn search --q "<query>" [--max 25] [--tags story|comment]',
      about: 'search Hacker News stories and comments by relevance (Algolia)',
      run: async (flags: Flags): Promise<HnHit[]> => {
        const params: Record<string, string> = {
          query: requireFlag(flags, 'q'),
          hitsPerPage: String(intFlag(flags, 'max', DEFAULT_MAX)),
        }
        const tags = flags.tags
        if (tags !== undefined) {
          params.tags = tags
        }
        const result = await fetchJson(withQuery(SEARCH_URL, params), searchSchema)
        return result.hits.map(toHit)
      },
    },
  ],
}

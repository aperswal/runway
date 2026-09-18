import { z } from 'zod'
import { STATUS, XError, issueMessages } from './errors.ts'
import { dispatch, json, type Handler, type MockRequest, type Route } from './http.ts'
import type { PostStore } from './posts.ts'

export type XDeps = { posts: PostStore; now: () => Date }

const OAUTH_PARAMS = [
  'oauth_consumer_key',
  'oauth_nonce',
  'oauth_signature',
  'oauth_signature_method',
  'oauth_timestamp',
  'oauth_token',
  'oauth_version',
]

const TWEET_MAX_LENGTH = 280
const X_EPOCH_MS = 1288834974657n
const TIMESTAMP_SHIFT = 22n
const FIRST_SEQUENCE = 0n
const SEQUENCE_STEP = 1n
const OAUTH_PREFIX = 'OAuth '
const OAUTH_PAIR = /^[A-Za-z0-9_]+="[^"]*"$/
const PAIR_SEPARATOR = '="'

const tweetSchema = z.object({
  text: z.string().min(1),
  media: z.object({ media_ids: z.array(z.string()).min(1) }).optional(),
})
const uploadSchema = z.object({
  media: z.object({ type: z.literal('image/png'), size: z.number().positive() }),
  media_category: z.literal('tweet_image'),
})

const parsePairs = (header: string): Record<string, string> | null => {
  const params: Record<string, string> = {}
  for (const pair of header.split(',')) {
    const trimmed = pair.trim()
    if (!OAUTH_PAIR.test(trimmed)) {
      return null
    }
    const separator = trimmed.indexOf(PAIR_SEPARATOR)
    params[trimmed.slice(0, separator)] = trimmed.slice(separator + PAIR_SEPARATOR.length, -1)
  }
  return params
}

export function parseOAuthHeader(header: string | null): Record<string, string> | null {
  if (header?.startsWith(OAUTH_PREFIX) !== true) {
    return null
  }
  const params = parsePairs(header.slice(OAUTH_PREFIX.length))
  if (params === null) {
    return null
  }
  const complete = OAUTH_PARAMS.every((name) => (params[name] ?? '').length > 0)
  return complete ? params : null
}

const unauthorized = (): XError => new XError(STATUS.unauthorized, 'Unauthorized', 'Unauthorized')

const notFound = (): never => {
  throw new XError(STATUS.notFound, 'Not Found Error', 'The requested resource was not found.')
}

const requireOAuth = (request: MockRequest): void => {
  if (parseOAuthHeader(request.headers.get('authorization')) === null) {
    throw unauthorized()
  }
}

const invalid = (issues: z.core.$ZodIssue[]): XError =>
  new XError(STATUS.badRequest, 'Invalid Request', issueMessages(issues))

type Ids = { next: () => string }
type Media = Map<string, number>

const imageOf = (media: Media, ids: string[] | undefined): number | null => {
  if (ids === undefined) {
    return null
  }
  const missing = ids.find((id) => !media.has(id))
  if (missing !== undefined) {
    throw new XError(STATUS.badRequest, 'Invalid Request', `media_ids: unknown media ${missing}`)
  }
  return ids.reduce((sum, id) => sum + Number(media.get(id)), 0)
}

const uploadRoute = (ids: Ids, media: Media): Route => ({
  method: 'POST',
  pattern: '/2/media/upload',
  handle: (request) => {
    requireOAuth(request)
    const parsed = uploadSchema.safeParse(request.body)
    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }
    const id = ids.next()
    media.set(id, parsed.data.media.size)
    return json({ data: { id, media_key: `3_${id}` } }, STATUS.created)
  },
})

const tweetRoute = (deps: XDeps, ids: Ids, media: Media): Route => ({
  method: 'POST',
  pattern: '/2/tweets',
  handle: (request) => {
    requireOAuth(request)
    const parsed = tweetSchema.safeParse(request.body)
    if (!parsed.success) {
      throw invalid(parsed.error.issues)
    }
    const { text } = parsed.data
    if (text.length > TWEET_MAX_LENGTH) {
      throw new XError(STATUS.forbidden, 'Forbidden', 'Forbidden', [
        'Your Tweet text is too long. Please try again.',
      ])
    }
    const image = imageOf(media, parsed.data.media?.media_ids)
    deps.posts.add({ network: 'x', text, image, receivedAt: deps.now().toISOString() })
    return json({ data: { id: ids.next(), text } }, STATUS.created)
  },
})

export function createX(deps: XDeps): Handler {
  let sequence = FIRST_SEQUENCE
  const media: Media = new Map()
  const ids: Ids = {
    next: () => {
      sequence += SEQUENCE_STEP
      const elapsed = BigInt(deps.now().getTime()) - X_EPOCH_MS
      return ((elapsed << TIMESTAMP_SHIFT) | sequence).toString()
    },
  }
  const routes = [uploadRoute(ids, media), tweetRoute(deps, ids, media)]
  return (request) => dispatch(routes, request, notFound)
}

import { z } from 'zod'
import { LinkedInError, LinkedInUnauthorizedError, STATUS, issueDetail } from './errors.ts'
import {
  bearerToken,
  dispatch,
  empty,
  json,
  param,
  type Handler,
  type MockRequest,
  type Route,
} from './http.ts'
import type { PostStore } from './posts.ts'

export type LinkedInDeps = { posts: PostStore; now: () => Date }

const RESTLI_PROTOCOL_VERSION = '2.0.0'
const MOCK_PERSON = { sub: 'mockperson', name: 'Mock Person' }
const versionHeader = z.string().regex(/^\d{6}$/)

const postSchema = z.object({
  author: z.string().regex(/^urn:li:person:[A-Za-z0-9_-]+$/),
  commentary: z.string().min(1),
  visibility: z.enum(['PUBLIC', 'CONNECTIONS', 'LOGGED_IN']),
  distribution: z.object({
    feedDistribution: z.enum(['MAIN_FEED', 'NONE']),
    targetEntities: z.array(z.unknown()),
    thirdPartyDistributionChannels: z.array(z.unknown()),
  }),
  lifecycleState: z.enum(['PUBLISHED', 'DRAFT']),
  isReshareDisabledByAuthor: z.boolean().optional(),
  content: z
    .object({ media: z.object({ id: z.string(), altText: z.string().optional() }) })
    .optional(),
})
const uploadSchema = z.object({
  initializeUploadRequest: z.object({ owner: z.string().regex(/^urn:li:person:[A-Za-z0-9_-]+$/) }),
})

const requireBearer = (request: MockRequest): void => {
  if (bearerToken(request.headers) === null) {
    throw new LinkedInUnauthorizedError()
  }
}

const requireRestHeaders = (request: MockRequest): void => {
  if (!versionHeader.safeParse(request.headers.get('linkedin-version')).success) {
    throw new LinkedInError(STATUS.upgradeRequired, 'Invalid or missing LinkedIn-Version header')
  }
  if (request.headers.get('x-restli-protocol-version') !== RESTLI_PROTOCOL_VERSION) {
    throw new LinkedInError(STATUS.badRequest, 'Invalid X-Restli-Protocol-Version header')
  }
}

const notFound = (): never => {
  throw new LinkedInError(STATUS.notFound, 'Not Found')
}

const UPLOAD_ACTION = 'initializeUpload'

type Images = Map<string, number | null>
type Sequence = { next: () => number }

const imageOf = (images: Images, id: string | undefined): number | null => {
  if (id === undefined) {
    return null
  }
  const size = images.get(id)
  if (size === undefined || size === null) {
    throw new LinkedInError(STATUS.unprocessable, `content.media.id: image ${id} was not uploaded`)
  }
  return size
}

const postRoute = (deps: LinkedInDeps, images: Images, sequence: Sequence): Route => ({
  method: 'POST',
  pattern: '/rest/posts',
  handle: (request) => {
    requireBearer(request)
    requireRestHeaders(request)
    const parsed = postSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new LinkedInError(STATUS.unprocessable, issueDetail(parsed.error.issues))
    }
    const image = imageOf(images, parsed.data.content?.media.id)
    deps.posts.add({
      network: 'linkedin',
      text: parsed.data.commentary,
      image,
      receivedAt: deps.now().toISOString(),
    })
    const id = `urn:li:share:${deps.now().getTime()}${sequence.next()}`
    return empty(STATUS.created, { 'x-restli-id': id })
  },
})

const registerRoute = (images: Images, sequence: Sequence): Route => ({
  method: 'POST',
  pattern: '/rest/images',
  handle: (request) => {
    requireBearer(request)
    requireRestHeaders(request)
    if (request.query.get('action') !== UPLOAD_ACTION) {
      throw new LinkedInError(STATUS.badRequest, 'Unknown action')
    }
    const parsed = uploadSchema.safeParse(request.body)
    if (!parsed.success) {
      throw new LinkedInError(STATUS.unprocessable, issueDetail(parsed.error.issues))
    }
    const n = sequence.next()
    const image = `urn:li:image:${n}`
    images.set(image, null)
    const uploadUrl = `${request.origin}/linkedin/rest/images/upload/${n}`
    return json({ value: { uploadUrl, image } })
  },
})

const uploadRoute = (images: Images): Route => ({
  method: 'PUT',
  pattern: '/rest/images/upload/:id',
  handle: (request, params) => {
    requireBearer(request)
    const image = `urn:li:image:${param(params, 'id')}`
    if (!images.has(image) || request.bytes.length === 0) {
      throw new LinkedInError(STATUS.notFound, 'Unknown upload')
    }
    images.set(image, request.bytes.length)
    return empty(STATUS.created)
  },
})

const userinfoRoute: Route = {
  method: 'GET',
  pattern: '/v2/userinfo',
  handle: (request) => {
    requireBearer(request)
    return json(MOCK_PERSON)
  },
}

export function createLinkedIn(deps: LinkedInDeps): Handler {
  let count = 0
  const sequence: Sequence = {
    next: () => {
      count += 1
      return count
    },
  }
  const images: Images = new Map()
  const routes = [
    postRoute(deps, images, sequence),
    registerRoute(images, sequence),
    uploadRoute(images),
    userinfoRoute,
  ]
  return (request) => dispatch(routes, request, notFound)
}

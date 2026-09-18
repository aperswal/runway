import { afterEach, describe, expect, it, vi } from 'vitest'
import { headerOf, jsonBody, stubFetch } from '../../test/helpers'
import { ExternalServiceError } from '../errors'
import { LINKEDIN_API_URL, escapeLittleText, postToLinkedIn, uploadLinkedInImage } from './linkedin'

const creds = { accessToken: 'tok', personUrn: 'urn:li:person:1' }

describe('escapeLittleText', () => {
  it('escapes little text reserved characters', () => {
    expect(escapeLittleText('a(b)[c]{d}<e>#f*g_h~i@j|k\\l')).toBe(
      'a\\(b\\)\\[c\\]\\{d\\}\\<e\\>\\#f\\*g\\_h\\~i\\@j\\|k\\\\l',
    )
  })
  it('leaves plain text alone', () =>
    expect(escapeLittleText('Sold $BTC, +1.0%.')).toBe('Sold $BTC, +1.0%.'))
})

const image = new Uint8Array([9, 8, 7])
const uploadRoutes = (base: string) => [
  {
    url: `${base}/rest/images?action=initializeUpload`,
    method: 'POST',
    body: { value: { uploadUrl: `${base}/upload/1`, image: 'urn:li:image:1' } },
  },
  { url: `${base}/upload/1`, method: 'PUT', status: 201, body: '' },
]

describe('uploadLinkedInImage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('registers the upload, puts the bytes and returns the image urn', async () => {
    const { calls } = stubFetch(uploadRoutes('https://li.test'))
    expect(await uploadLinkedInImage(image, creds, 'https://li.test')).toBe('urn:li:image:1')
    expect(jsonBody(calls[0])).toEqual({ initializeUploadRequest: { owner: 'urn:li:person:1' } })
    expect(headerOf(calls[0], 'linkedin-version')).toBe('202508')
    expect(calls[1]?.method).toBe('PUT')
    expect(headerOf(calls[1], 'authorization')).toBe('Bearer tok')
    expect(headerOf(calls[1], 'content-type')).toBe('application/octet-stream')
    expect(calls[1]?.init?.body).toBe(image)
  })

  it('defaults to the production api', async () => {
    const { calls } = stubFetch(uploadRoutes(LINKEDIN_API_URL))
    await uploadLinkedInImage(image, creds)
    expect(calls[0]?.url).toBe('https://api.linkedin.com/rest/images?action=initializeUpload')
  })

  it('raises when the upload cannot be registered', async () => {
    stubFetch([
      {
        url: 'https://li.test/rest/images?action=initializeUpload',
        method: 'POST',
        status: 401,
        body: 'nope',
      },
    ])
    await expect(uploadLinkedInImage(image, creds, 'https://li.test')).rejects.toThrow(
      'linkedin 401: nope',
    )
  })

  it('raises when the registration has no upload url', async () => {
    stubFetch([
      {
        url: 'https://li.test/rest/images?action=initializeUpload',
        method: 'POST',
        body: { value: {} },
      },
    ])
    await expect(uploadLinkedInImage(image, creds, 'https://li.test')).rejects.toThrow(
      'linkedin 200: upload without url: {"value":{}}',
    )
  })

  it('raises when the bytes are rejected', async () => {
    const [start] = uploadRoutes('https://li.test')
    stubFetch([
      start!,
      { url: 'https://li.test/upload/1', method: 'PUT', status: 500, body: 'full' },
    ])
    await expect(uploadLinkedInImage(image, creds, 'https://li.test')).rejects.toThrow(
      'linkedin 500: full',
    )
  })
})

describe('postToLinkedIn', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts an escaped public update with the chart and returns the post id', async () => {
    const { calls } = stubFetch([
      ...uploadRoutes('https://li.test'),
      {
        url: 'https://li.test/rest/posts',
        method: 'POST',
        status: 201,
        body: '',
        headers: { 'x-restli-id': 'urn:li:share:9' },
      },
    ])
    expect(await postToLinkedIn('Buying $X (now)', image, creds, 'https://li.test')).toBe(
      'urn:li:share:9',
    )
    const post = calls[2]
    expect(headerOf(post, 'authorization')).toBe('Bearer tok')
    expect(headerOf(post, 'content-type')).toBe('application/json')
    expect(headerOf(post, 'linkedin-version')).toBe('202508')
    expect(headerOf(post, 'x-restli-protocol-version')).toBe('2.0.0')
    expect(jsonBody(post)).toEqual({
      author: 'urn:li:person:1',
      commentary: 'Buying $X \\(now\\)',
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: { media: { id: 'urn:li:image:1', altText: 'Runway equity over time' } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    })
  })

  it('defaults to the production api', async () => {
    const { calls } = stubFetch([
      ...uploadRoutes(LINKEDIN_API_URL),
      {
        url: `${LINKEDIN_API_URL}/rest/posts`,
        method: 'POST',
        body: '',
        headers: { 'x-restli-id': 'id' },
      },
    ])
    await postToLinkedIn('x', image, creds)
    expect(calls[2]?.url).toBe('https://api.linkedin.com/rest/posts')
  })

  it('raises on http errors', async () => {
    stubFetch([
      ...uploadRoutes('https://li.test'),
      { url: 'https://li.test/rest/posts', method: 'POST', status: 422, body: 'bad' },
    ])
    await expect(postToLinkedIn('x', image, creds, 'https://li.test')).rejects.toThrow(
      'linkedin 422: bad',
    )
  })

  it('raises without a post id header', async () => {
    stubFetch([
      ...uploadRoutes('https://li.test'),
      { url: 'https://li.test/rest/posts', method: 'POST', body: '' },
    ])
    const error = await postToLinkedIn('x', image, creds, 'https://li.test').catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ExternalServiceError)
    expect((error as Error).message).toBe('linkedin 200: response without x-restli-id')
  })
})

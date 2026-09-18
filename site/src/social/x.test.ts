import { afterEach, describe, expect, it, vi } from 'vitest'
import { headerOf, jsonBody, stubFetch } from '../../test/helpers'
import { oauthParams, oauthSignatureMatches } from '../../test/oauth'
import { ExternalServiceError } from '../errors'
import { X_API_URL, oauthHeader, oauthSignature, postToX, signingKey, uploadXMedia } from './x'

const creds = {
  apiKey: 'consumer',
  apiSecret: 'consumer-secret',
  accessToken: 'token',
  accessSecret: 'token-secret',
}

const secrets = { consumerSecret: creds.apiSecret, tokenSecret: creds.accessSecret }

describe('signingKey', () => {
  it('derives a non-extractable hmac key from both secrets', async () => {
    const key = await signingKey(secrets)
    expect(key.extractable).toBe(false)
    expect(key.algorithm).toMatchObject({ name: 'HMAC', hash: { name: 'SHA-1' } })
    expect(key.usages).toEqual(['sign'])
  })
})

describe('oauthSignature', () => {
  it('matches the reference vector from the X developer docs', async () => {
    const params = {
      include_entities: 'true',
      status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
      oauth_consumer_key: 'xvz1evFS4wEEPTGEFPHBog',
      oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '1318622958',
      oauth_token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
      oauth_version: '1.0',
    }
    const sig = await oauthSignature(
      'POST',
      'https://api.twitter.com/1.1/statuses/update.json',
      params,
      {
        consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
        tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
      },
    )
    expect(sig).toBe('hCtSmYh+iHYCEqBWrE7C7hYmtUk=')
  })

  it('percent-encodes reserved characters the strict way', async () => {
    const plain = await oauthSignature(
      'post',
      'https://x.test/a',
      { k: "v!'()*" },
      { consumerSecret: 'a', tokenSecret: 'b' },
    )
    const other = await oauthSignature(
      'post',
      'https://x.test/a',
      { k: 'v' },
      { consumerSecret: 'a', tokenSecret: 'b' },
    )
    expect(plain).not.toBe(other)
  })
})

describe('oauthHeader', () => {
  afterEach(() => vi.useRealTimers())

  it('builds an OAuth header with a signature', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T00:00:00.500Z'))
    const url = 'https://x.test/2/tweets'
    const header = await oauthHeader('POST', url, creds)
    expect(header).toMatch(/^OAuth oauth_consumer_key="consumer", oauth_nonce="[0-9a-f]{32}", /)
    expect(header).toContain(
      'oauth_signature_method="HMAC-SHA1", oauth_timestamp="1788220800", oauth_token="token", oauth_version="1.0", oauth_signature="',
    )
    expect(header).toMatch(/oauth_signature="[A-Za-z0-9%]+"$/)
    expect(await oauthSignatureMatches(header, url, secrets)).toBe(true)
  })

  it('percent-encodes header values the strict way', async () => {
    const header = await oauthHeader('POST', 'https://x.test/a', { ...creds, apiKey: "a*b'(c)!" })
    expect(header).toContain('oauth_consumer_key="a%2Ab%27%28c%29%21"')
  })
})

const image = new Uint8Array([1, 2, 3])
const upload = (base: string) => ({
  url: `${base}/2/media/upload`,
  method: 'POST',
  body: { data: { id: 'media-1' } },
})

describe('uploadXMedia', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends the png as multipart form data and returns the media id', async () => {
    const { calls } = stubFetch([upload('https://x.test')])
    expect(await uploadXMedia(image, creds, 'https://x.test')).toBe('media-1')
    const form = calls[0]?.init?.body as FormData
    expect(form.get('media_category')).toBe('tweet_image')
    const file = form.get('media') as File
    expect(file.type).toBe('image/png')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(image)
    const header = headerOf(calls[0], 'authorization')
    expect(await oauthSignatureMatches(header, 'https://x.test/2/media/upload', secrets)).toBe(true)
  })

  it('defaults to the production api', async () => {
    const { calls } = stubFetch([upload(X_API_URL)])
    await uploadXMedia(image, creds)
    expect(calls[0]?.url).toBe('https://api.x.com/2/media/upload')
  })
})

describe('postToX', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uploads the chart, posts the text with it and returns the tweet id', async () => {
    const { calls } = stubFetch([
      upload('https://x.test'),
      { url: 'https://x.test/2/tweets', method: 'POST', body: { data: { id: '123' } } },
    ])
    expect(await postToX('hello', image, creds, 'https://x.test')).toBe('123')
    expect(jsonBody(calls[1])).toEqual({ text: 'hello', media: { media_ids: ['media-1'] } })
    const header = headerOf(calls[1], 'authorization')
    expect(header).toMatch(/^OAuth /)
    expect(oauthParams(header)).toMatchObject({ oauth_consumer_key: 'consumer' })
    expect(await oauthSignatureMatches(header, 'https://x.test/2/tweets', secrets)).toBe(true)
    expect(headerOf(calls[1], 'content-type')).toBe('application/json')
  })

  it('defaults to the production api', async () => {
    const { calls } = stubFetch([
      upload(X_API_URL),
      { url: `${X_API_URL}/2/tweets`, method: 'POST', body: { data: { id: '1' } } },
    ])
    await postToX('hello', image, creds)
    expect(calls[1]?.url).toBe('https://api.x.com/2/tweets')
  })

  it('raises on http errors', async () => {
    stubFetch([
      upload('https://x.test'),
      { url: 'https://x.test/2/tweets', method: 'POST', status: 403, body: 'forbidden' },
    ])
    await expect(postToX('hello', image, creds, 'https://x.test')).rejects.toThrow(
      'x 403: forbidden',
    )
  })

  it('raises when the response has no id', async () => {
    stubFetch([
      upload('https://x.test'),
      { url: 'https://x.test/2/tweets', method: 'POST', body: { data: {} } },
    ])
    const error = await postToX('hello', image, creds, 'https://x.test').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalServiceError)
    expect((error as ExternalServiceError).service).toBe('x')
    expect((error as Error).message).toBe('x 200: response without id: {"data":{}}')
  })
})

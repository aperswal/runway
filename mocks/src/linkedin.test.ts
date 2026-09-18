import { describe, expect, it } from 'vitest'
import { readJson, setup } from './test-support.ts'

const HEADERS = {
  authorization: 'Bearer token',
  'linkedin-version': '202508',
  'x-restli-protocol-version': '2.0.0',
}

const post = (commentary = 'hello') => ({
  author: 'urn:li:person:abc123',
  commentary,
  visibility: 'PUBLIC',
  distribution: {
    feedDistribution: 'MAIN_FEED',
    targetEntities: [],
    thirdPartyDistributionChannels: [],
  },
  lifecycleState: 'PUBLISHED',
  isReshareDisabledByAuthor: false,
})

describe('linkedin api', () => {
  it('creates a post and returns the share urn header with an empty body', async () => {
    const { call, deps } = setup()
    const res = await call('POST', '/linkedin/rest/posts', { headers: HEADERS, body: post() })
    expect(res.status).toBe(201)
    expect(res.headers.get('x-restli-id')).toBe('urn:li:share:17882748000001')
    expect(await res.text()).toBe('')
    const again = await call('POST', '/linkedin/rest/posts', {
      headers: HEADERS,
      body: post('two'),
    })
    expect(again.headers.get('x-restli-id')).toBe('urn:li:share:17882748000002')
    expect(deps.posts.byNetwork('linkedin')).toEqual([
      { network: 'linkedin', text: 'hello', image: null, receivedAt: '2026-09-01T15:00:00.000Z' },
      { network: 'linkedin', text: 'two', image: null, receivedAt: '2026-09-01T15:00:00.000Z' },
    ])
  })

  it('registers an image upload, accepts the bytes and attaches the image to a post', async () => {
    const { call, deps, handler } = setup()
    const started = await call('POST', '/linkedin/rest/images?action=initializeUpload', {
      headers: HEADERS,
      body: { initializeUploadRequest: { owner: 'urn:li:person:1' } },
    })
    expect(started.status).toBe(200)
    const { value } = await readJson<{ value: { uploadUrl: string; image: string } }>(started)
    expect(value).toEqual({
      uploadUrl: 'http://mocks/linkedin/rest/images/upload/1',
      image: 'urn:li:image:1',
    })
    const early = await call('POST', '/linkedin/rest/posts', {
      headers: HEADERS,
      body: { ...post(), content: { media: { id: value.image } } },
    })
    expect(early.status).toBe(422)
    expect(await early.json()).toMatchObject({
      message: 'content.media.id: image urn:li:image:1 was not uploaded',
    })
    const put = await handler(
      new Request(value.uploadUrl, {
        method: 'PUT',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/octet-stream' },
        body: new Uint8Array(5),
      }),
    )
    expect(put.status).toBe(201)
    const res = await call('POST', '/linkedin/rest/posts', {
      headers: HEADERS,
      body: { ...post(), content: { media: { id: value.image, altText: 'chart' } } },
    })
    expect(res.status).toBe(201)
    expect(deps.posts.byNetwork('linkedin')).toEqual([
      { network: 'linkedin', text: 'hello', image: 5, receivedAt: '2026-09-01T15:00:00.000Z' },
    ])
  })

  it('rejects bad upload registrations and unknown or empty uploads', async () => {
    const { call, handler } = setup()
    const register = (
      body: unknown,
      headers: Record<string, string> = HEADERS,
      action = 'initializeUpload',
    ) => call('POST', `/linkedin/rest/images?action=${action}`, { headers, body })
    const request = (owner: string) => ({ initializeUploadRequest: { owner } })
    const action = await register(request('urn:li:person:1'), HEADERS, 'other')
    expect(action.status).toBe(400)
    expect(await action.json()).toMatchObject({ message: 'Unknown action' })
    for (const owner of ['nope', 'xurn:li:person:1', 'urn:li:person:1/x']) {
      expect((await register(request(owner))).status).toBe(422)
    }
    expect((await register(request('urn:li:person:e2e'))).status).toBe(200)
    expect((await register(request('urn:li:person:1'), {})).status).toBe(401)
    const { 'linkedin-version': _v, ...noVersion } = HEADERS
    expect((await register(request('urn:li:person:1'), noVersion)).status).toBe(426)
    const unregistered = await call('POST', '/linkedin/rest/posts', {
      headers: HEADERS,
      body: { ...post(), content: { media: { id: 'urn:li:image:99' } } },
    })
    expect(unregistered.status).toBe(422)
    const unknown = await handler(
      new Request('http://mocks/linkedin/rest/images/upload/9', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/octet-stream' },
        body: new Uint8Array(1),
      }),
    )
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ message: 'Unknown upload' })
    await call('POST', '/linkedin/rest/images?action=initializeUpload', {
      headers: HEADERS,
      body: { initializeUploadRequest: { owner: 'urn:li:person:1' } },
    })
    const empty = await handler(
      new Request('http://mocks/linkedin/rest/images/upload/1', {
        method: 'PUT',
        headers: { authorization: 'Bearer tok' },
      }),
    )
    expect(empty.status).toBe(404)
    const anonymous = await handler(
      new Request('http://mocks/linkedin/rest/images/upload/1', {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(1),
      }),
    )
    expect(anonymous.status).toBe(401)
  })

  it('accepts every visibility, distribution and lifecycle option', async () => {
    const { call } = setup()
    const variants = [
      { visibility: 'CONNECTIONS' },
      { visibility: 'LOGGED_IN' },
      { distribution: { ...post().distribution, feedDistribution: 'NONE' } },
      { lifecycleState: 'DRAFT' },
    ]
    for (const variant of variants) {
      const res = await call('POST', '/linkedin/rest/posts', {
        headers: HEADERS,
        body: { ...post(), ...variant },
      })
      expect(res.status).toBe(201)
    }
  })

  it('requires a bearer token', async () => {
    const { call } = setup()
    const res = await call('POST', '/linkedin/rest/posts', {
      headers: { ...HEADERS, authorization: 'Basic x' },
      body: post(),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      serviceErrorCode: 65600,
      message: 'Invalid access token',
      status: 401,
    })
  })

  it('requires the version and protocol headers', async () => {
    const { call } = setup()
    const versions = [undefined, 'v2', '2025081', '20250', 'x202508', '202508x']
    for (const version of versions) {
      const res = await call('POST', '/linkedin/rest/posts', {
        headers: {
          authorization: 'Bearer t',
          'x-restli-protocol-version': '2.0.0',
          ...(version === undefined ? {} : { 'linkedin-version': version }),
        },
        body: post(),
      })
      expect(res.status).toBe(426)
      expect(await res.json()).toEqual({
        message: 'Invalid or missing LinkedIn-Version header',
        status: 426,
      })
    }
    const noProtocol = await call('POST', '/linkedin/rest/posts', {
      headers: { authorization: 'Bearer t', 'linkedin-version': '202508' },
      body: post(),
    })
    expect(noProtocol.status).toBe(400)
    expect(await noProtocol.json()).toEqual({
      message: 'Invalid X-Restli-Protocol-Version header',
      status: 400,
    })
    const oldProtocol = await call('POST', '/linkedin/rest/posts', {
      headers: { ...HEADERS, 'x-restli-protocol-version': '1.0.0' },
      body: post(),
    })
    expect(oldProtocol.status).toBe(400)
  })

  it('validates the author urn', async () => {
    const { call } = setup()
    const authors = [
      'urn:li:organization:1',
      'xurn:li:person:abc',
      'urn:li:person:abc!',
      'urn:li:person:',
    ]
    for (const author of authors) {
      const res = await call('POST', '/linkedin/rest/posts', {
        headers: HEADERS,
        body: { ...post(), author },
      })
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({
        status: 422,
        message: 'author Invalid string: must match pattern /^urn:li:person:[A-Za-z0-9_-]+$/',
      })
    }
  })

  it('reports every issue with its dotted path', async () => {
    const { call } = setup()
    const res = await call('POST', '/linkedin/rest/posts', {
      headers: HEADERS,
      body: {
        ...post(),
        distribution: { ...post().distribution, feedDistribution: 'ALL' },
        lifecycleState: 'GONE',
      },
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({
      status: 422,
      message:
        'distribution.feedDistribution Invalid option: expected one of "MAIN_FEED"|"NONE"; lifecycleState Invalid option: expected one of "PUBLISHED"|"DRAFT"',
    })
    const bare = await call('POST', '/linkedin/rest/posts', {
      headers: HEADERS,
      body: { ...post(), distribution: {} },
    })
    expect(bare.status).toBe(422)
    const blank = await call('POST', '/linkedin/rest/posts', {
      headers: HEADERS,
      body: post(''),
    })
    expect(blank.status).toBe(422)
  })

  it('serves userinfo behind the bearer token', async () => {
    const { call } = setup()
    const res = await call('GET', '/linkedin/v2/userinfo', {
      headers: { authorization: 'Bearer t' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sub: 'mockperson', name: 'Mock Person' })
    const anonymous = await call('GET', '/linkedin/v2/userinfo')
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toMatchObject({ serviceErrorCode: 65600 })
  })

  it('returns 404 for other paths', async () => {
    const { call } = setup()
    const res = await call('GET', '/linkedin/v2/me', { headers: HEADERS })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ message: 'Not Found', status: 404 })
  })
})

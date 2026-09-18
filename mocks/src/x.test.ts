import { describe, expect, it } from 'vitest'
import { readJson, setup } from './test-support.ts'
import { parseOAuthHeader } from './x.ts'

type Tweet = { data: { id: string; text: string } }

const OAUTH =
  'OAuth oauth_consumer_key="ck", oauth_nonce="n", oauth_signature="sig%3D", oauth_signature_method="HMAC-SHA1", oauth_timestamp="1", oauth_token="tok", oauth_version="1.0"'

describe('parseOAuthHeader', () => {
  it('parses a complete header', () => {
    expect(parseOAuthHeader(OAUTH)).toEqual({
      oauth_consumer_key: 'ck',
      oauth_nonce: 'n',
      oauth_signature: 'sig%3D',
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: '1',
      oauth_token: 'tok',
      oauth_version: '1.0',
    })
    expect(parseOAuthHeader(`${OAUTH}, realm=""`)).toMatchObject({ realm: '' })
  })

  it('rejects missing, malformed and incomplete headers', () => {
    expect(parseOAuthHeader(null)).toBeNull()
    expect(parseOAuthHeader('Bearer x')).toBeNull()
    expect(parseOAuthHeader('OAuth garbage')).toBeNull()
    expect(parseOAuthHeader('OAuth oauth_consumer_key="ck"')).toBeNull()
    expect(parseOAuthHeader(OAUTH.replace('"tok"', '""'))).toBeNull()
    expect(parseOAuthHeader(`${OAUTH}, bogus`)).toBeNull()
    expect(parseOAuthHeader(`${OAUTH}, -extra="1"`)).toBeNull()
    expect(parseOAuthHeader(`${OAUTH}, extra="1"x`)).toBeNull()
    expect(parseOAuthHeader(`x ${OAUTH}`)).toBeNull()
  })
})

describe('x api', () => {
  it('creates a tweet with a snowflake id and stores it', async () => {
    const { call, deps } = setup()
    const res = await call('POST', '/x/2/tweets', {
      headers: { authorization: OAUTH },
      body: { text: 'hello' },
    })
    expect(res.status).toBe(201)
    expect(await readJson<Tweet>(res)).toEqual({
      data: { id: '2094802457195446273', text: 'hello' },
    })
    const second = await readJson<Tweet>(
      await call('POST', '/x/2/tweets', {
        headers: { authorization: OAUTH },
        body: { text: 'again' },
      }),
    )
    expect(second).toEqual({ data: { id: '2094802457195446274', text: 'again' } })
    expect(deps.posts.byNetwork('x')).toEqual([
      { network: 'x', text: 'hello', image: null, receivedAt: '2026-09-01T15:00:00.000Z' },
      { network: 'x', text: 'again', image: null, receivedAt: '2026-09-01T15:00:00.000Z' },
    ])
  })

  it('rejects requests without a valid oauth header', async () => {
    const { call } = setup()
    const res = await call('POST', '/x/2/tweets', { body: { text: 'hello' } })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      title: 'Unauthorized',
      detail: 'Unauthorized',
      type: 'about:blank',
      status: 401,
    })
  })

  it('rejects text over 280 characters with the 403 shape', async () => {
    const { call } = setup()
    const res = await call('POST', '/x/2/tweets', {
      headers: { authorization: OAUTH },
      body: { text: 'a'.repeat(281) },
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      title: 'Forbidden',
      detail: 'Forbidden',
      type: 'about:blank',
      status: 403,
      errors: [{ message: 'Your Tweet text is too long. Please try again.' }],
    })
    const ok = await call('POST', '/x/2/tweets', {
      headers: { authorization: OAUTH },
      body: { text: 'a'.repeat(280) },
    })
    expect(ok.status).toBe(201)
  })

  it('rejects bodies without text', async () => {
    const { call } = setup()
    const res = await call('POST', '/x/2/tweets', { headers: { authorization: OAUTH }, body: {} })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      title: 'Invalid Request',
      detail: 'Invalid input: expected string, received undefined',
      type: 'about:blank',
      status: 400,
    })
    const blank = await call('POST', '/x/2/tweets', {
      headers: { authorization: OAUTH },
      body: { text: '' },
    })
    expect(blank.status).toBe(400)
  })

  it('uploads png media and attaches it to a tweet', async () => {
    const { call, deps, handler } = setup()
    const form = new FormData()
    form.set('media', new Blob([new Uint8Array(3)], { type: 'image/png' }), 'chart.png')
    form.set('media_category', 'tweet_image')
    const upload = await handler(
      new Request('http://mocks/x/2/media/upload', {
        method: 'POST',
        headers: { authorization: OAUTH },
        body: form,
      }),
    )
    expect(upload.status).toBe(201)
    const { data } = await readJson<{ data: { id: string; media_key: string } }>(upload)
    expect(data.media_key).toBe(`3_${data.id}`)
    const res = await call('POST', '/x/2/tweets', {
      headers: { authorization: OAUTH },
      body: { text: 'with chart', media: { media_ids: [data.id] } },
    })
    expect(res.status).toBe(201)
    expect(deps.posts.byNetwork('x')).toEqual([
      { network: 'x', text: 'with chart', image: 3, receivedAt: '2026-09-01T15:00:00.000Z' },
    ])
  })

  it('rejects uploads that are not png tweet images and unknown media ids', async () => {
    const { call, handler } = setup()
    const form = new FormData()
    form.set('media', new Blob([new Uint8Array(3)], { type: 'image/gif' }), 'c.gif')
    form.set('media_category', 'tweet_image')
    const upload = await handler(
      new Request('http://mocks/x/2/media/upload', {
        method: 'POST',
        headers: { authorization: OAUTH },
        body: form,
      }),
    )
    expect(upload.status).toBe(400)
    const unauthorized = await handler(
      new Request('http://mocks/x/2/media/upload', { method: 'POST', body: form }),
    )
    expect(unauthorized.status).toBe(401)
    const res = await call('POST', '/x/2/tweets', {
      headers: { authorization: OAUTH },
      body: { text: 'x', media: { media_ids: ['nope'] } },
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      title: 'Invalid Request',
      detail: 'media_ids: unknown media nope',
    })
    const none = await call('POST', '/x/2/tweets', {
      headers: { authorization: OAUTH },
      body: { text: 'x', media: { media_ids: [] } },
    })
    expect(none.status).toBe(400)
  })

  it('returns 404 for other paths', async () => {
    const { call } = setup()
    const res = await call('GET', '/x/2/users/me', { headers: { authorization: OAUTH } })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      title: 'Not Found Error',
      detail: 'The requested resource was not found.',
      type: 'about:blank',
      status: 404,
    })
  })
})

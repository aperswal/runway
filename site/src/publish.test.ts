import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LINKEDIN_CONFIG,
  TEST_CONFIG,
  X_CONFIG,
  db,
  headerOf,
  insertTrade,
  jsonBody,
  resetDb,
  seedFund,
  stubFetch,
} from '../test/helpers'
import { oauthParams, oauthSignatureMatches } from '../test/oauth'
import { posts } from './db/schema'
import { parseConfig } from './env'
import { StateError } from './errors'
import { publishTrade, publishers } from './publish'
import { MISSING_AT_BROKER } from './reconcile'

const xRoute = (status = 201): Parameters<typeof stubFetch>[0][number] => ({
  url: 'https://x.test/2/tweets',
  method: 'POST',
  status,
  body: status < 300 ? { data: { id: 'tweet-1' } } : 'rate limited',
})
const liRoute = {
  url: 'https://li.test/rest/posts',
  method: 'POST',
  status: 201,
  body: '',
  headers: { 'x-restli-id': 'share-1' },
}
const uploads = [
  { url: 'https://x.test/2/media/upload', method: 'POST', body: { data: { id: 'media-1' } } },
  {
    url: 'https://li.test/rest/images?action=initializeUpload',
    method: 'POST',
    body: { value: { uploadUrl: 'https://li.test/upload/1', image: 'urn:li:image:1' } },
  },
  { url: 'https://li.test/upload/1', method: 'PUT', status: 201, body: '' },
]
const png = new Uint8Array([137, 80, 78, 71])

describe('publishers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is empty without social config', () => {
    expect(Object.keys(publishers(parseConfig(TEST_CONFIG)))).toEqual([])
  })

  it('builds one publisher per configured network', () => {
    const both = publishers(parseConfig({ ...TEST_CONFIG, ...X_CONFIG, ...LINKEDIN_CONFIG }))
    expect(Object.keys(both)).toEqual(['x', 'linkedin'])
  })

  it('fills missing secrets with empty strings', async () => {
    const { calls } = stubFetch([...uploads, xRoute(), liRoute])
    const config = {
      ...parseConfig(TEST_CONFIG),
      X_API_KEY: 'lonely',
      LINKEDIN_ACCESS_TOKEN: 'lonely-token',
    }
    const out = publishers(config)
    await out.x?.('hi', png)
    await out.linkedin?.('hi', png)
    const header = headerOf(calls[1], 'authorization')
    expect(oauthParams(header)).toMatchObject({ oauth_consumer_key: 'lonely', oauth_token: '' })
    expect(
      await oauthSignatureMatches(header, 'https://x.test/2/tweets', {
        consumerSecret: '',
        tokenSecret: '',
      }),
    ).toBe(true)
    expect(jsonBody(calls[2])).toEqual({ initializeUploadRequest: { owner: '' } })
    expect(jsonBody(calls[4]).author).toBe('')
  })
})

describe('publishTrade', () => {
  const config = parseConfig({ ...TEST_CONFIG, ...X_CONFIG, ...LINKEDIN_CONFIG })

  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rejects unknown trades', async () => {
    await expect(publishTrade(db, config, { tradeId: 42, kind: 'buy' })).rejects.toThrow(StateError)
  })

  it('does nothing without configured networks', async () => {
    const { calls } = stubFetch([])
    const trade = await insertTrade()
    const none = parseConfig(TEST_CONFIG)
    expect(await publishTrade(db, none, { tradeId: trade.id, kind: 'buy' })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('silently skips exits that should not be published', async () => {
    const { calls } = stubFetch([])
    const trade = await insertTrade({ status: 'closed', exitReason: MISSING_AT_BROKER })
    expect(await publishTrade(db, config, { tradeId: trade.id, kind: 'sell' })).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('posts a buy to every network and records each post', async () => {
    const { calls } = stubFetch([...uploads, xRoute(), liRoute])
    const trade = await insertTrade()
    expect(await publishTrade(db, config, { tradeId: trade.id, kind: 'buy' })).toEqual([])
    expect(calls.map((c) => c.url)).toEqual([
      'https://x.test/2/media/upload',
      'https://x.test/2/tweets',
      'https://li.test/rest/images?action=initializeUpload',
      'https://li.test/upload/1',
      'https://li.test/rest/posts',
    ])
    const form = calls[0]?.init?.body as FormData
    const file = form.get('media') as File
    const bytes = new Uint8Array(await file.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual([137, 80, 78, 71])
    expect(calls[3]?.init?.body).toBeInstanceOf(Uint8Array)
    const rows = await db.select().from(posts)
    expect(rows.map((r) => [r.network, r.status, r.externalId, r.kind, r.tradeId])).toEqual([
      ['x', 'posted', 'tweet-1', 'buy', trade.id],
      ['linkedin', 'posted', 'share-1', 'buy', trade.id],
    ])
  })

  it('posts buys regardless of the exit filters', async () => {
    const { calls } = stubFetch([...uploads, xRoute(), liRoute])
    const trade = await insertTrade({ qty: 0, exitReason: 'order canceled' })
    expect(await publishTrade(db, config, { tradeId: trade.id, kind: 'buy' })).toEqual([])
    expect(calls).toHaveLength(5)
  })

  it('skips networks that already have this post and reports failures', async () => {
    const { calls } = stubFetch([...uploads, xRoute(429)])
    const trade = await insertTrade({
      status: 'closed',
      exitPrice: 220,
      exitReason: 'target',
      closedAt: '2026-08-21T14:00:00.000Z',
    })
    await db.insert(posts).values({
      tradeId: trade.id,
      kind: 'sell',
      network: 'linkedin',
      status: 'posted',
      externalId: 'old',
      createdAt: '2026-08-21T14:01:00.000Z',
    })
    const failures = await publishTrade(db, config, { tradeId: trade.id, kind: 'sell' })
    expect(failures).toEqual(['x: x 429: rate limited'])
    expect(calls).toHaveLength(2)
    const rows = await db.select().from(posts)
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatchObject({ network: 'x', status: 'failed', error: 'x 429: rate limited' })
  })
})

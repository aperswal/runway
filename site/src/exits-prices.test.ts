import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  accountJson,
  clockJson,
  fakeQueue,
  insertTrade,
  positionJson,
  resetDb,
  seedFund,
  stubFetch,
  testEnv,
} from '../test/helpers'
import { buildDeps } from './deps'
import { runCycle } from './exits'

const queue = fakeQueue()
const base = buildDeps(testEnv({ POSTS: queue.queue }))
const deps = { db: base.db, alpaca: base.alpaca, postQueue: queue.queue }

describe('runCycle prices', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('does not ask for latest prices when every open lot is priced by the broker', async () => {
    await insertTrade({ symbol: 'AAPL' })
    const { calls } = stubFetch([
      { url: `${ALPACA}/v2/account`, body: accountJson() },
      { url: `${ALPACA}/v2/clock`, body: clockJson(true) },
      { url: `${ALPACA}/v2/positions`, body: [positionJson({ currentPrice: '210' })] },
    ])
    await runCycle(deps)
    expect(calls.some((c) => c.url.includes('trades/latest'))).toBe(false)
  })
})

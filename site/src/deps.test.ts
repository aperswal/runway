import { describe, expect, it } from 'vitest'
import { testEnv } from '../test/helpers'
import { DATA_URL, LIVE_TRADING_URL, PAPER_TRADING_URL } from './alpaca'
import { buildDeps, safeEqual } from './deps'

const urlsOf = (deps: ReturnType<typeof buildDeps>): { trading: string; data: string } =>
  (deps.alpaca as unknown as { urls: { trading: string; data: string } }).urls

describe('buildDeps', () => {
  it('wires config, db, alpaca, queue and summary options', () => {
    const env = testEnv()
    const deps = buildDeps(env)
    expect(deps.config.SUBSCRIPTION_USD).toBe(200)
    expect(deps.postQueue).toBe(env.POSTS)
    expect(deps.summary).toEqual({
      rates: { subscriptionUsd: 200, platformUsd: 5, xPostUsd: 0.015 },
      payoutFraction: 0.2,
    })
    expect(urlsOf(deps)).toEqual({ trading: 'https://alpaca.test', data: 'https://data.test' })
  })

  it('uses the paper url without an override', () => {
    const deps = buildDeps(testEnv({ ALPACA_TRADING_URL: '', ALPACA_DATA_URL: '' }))
    expect(urlsOf(deps)).toEqual({
      trading: 'https://paper-api.alpaca.markets',
      data: 'https://data.alpaca.markets',
    })
    expect({ PAPER_TRADING_URL, DATA_URL }).toEqual({
      PAPER_TRADING_URL: 'https://paper-api.alpaca.markets',
      DATA_URL: 'https://data.alpaca.markets',
    })
  })

  it('uses the live url when paper is off', () => {
    const deps = buildDeps(testEnv({ ALPACA_TRADING_URL: '', ALPACA_PAPER: 'false' }))
    expect(urlsOf(deps).trading).toBe('https://api.alpaca.markets')
    expect(LIVE_TRADING_URL).toBe('https://api.alpaca.markets')
  })
})

describe('safeEqual', () => {
  it('is true for identical strings', () => expect(safeEqual('abc', 'abc')).toBe(true))
  it('is false for same-length differences', () => expect(safeEqual('abc', 'abd')).toBe(false))
  it('is false for different lengths', () => expect(safeEqual('abc', 'abcd')).toBe(false))
})

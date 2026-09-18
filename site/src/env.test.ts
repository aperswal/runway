import { describe, expect, it } from 'vitest'
import { LINKEDIN_CONFIG, TEST_CONFIG, X_CONFIG } from '../test/helpers'
import { parseConfig } from './env'
import { ConfigError } from './errors'

describe('parseConfig', () => {
  it('parses a full config, blanking empty optionals and applying defaults', () => {
    const config = parseConfig(TEST_CONFIG)
    expect(config.SUBSCRIPTION_USD).toBe(200)
    expect(config.PLATFORM_USD).toBe(5)
    expect(config.X_POST_USD).toBe(0.015)
    expect(config.PAYOUT_FRACTION).toBe(0.2)
    expect(config.X_API_KEY).toBeUndefined()
    expect(config.LINKEDIN_PERSON_URN).toBeUndefined()
    expect(config.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(config.ALPACA_TRADING_URL).toBe('https://alpaca.test')
  })

  it('uses defaults when optional numbers are absent', () => {
    const { PLATFORM_USD: _p, X_POST_USD: _x, PAYOUT_FRACTION: _f, ...rest } = TEST_CONFIG
    const config = parseConfig(rest)
    expect(config.PLATFORM_USD).toBe(5)
    expect(config.X_POST_USD).toBe(0.015)
    expect(config.PAYOUT_FRACTION).toBe(0.2)
  })

  it('treats blank urls as unset and keeps absent ones undefined', () => {
    const config = parseConfig({ ...TEST_CONFIG, ALPACA_TRADING_URL: '', X_API_URL: undefined })
    expect(config.ALPACA_TRADING_URL).toBeUndefined()
    expect(config.X_API_URL).toBeUndefined()
    expect(parseConfig({ ...TEST_CONFIG, AGENT_MODEL: 'claude' }).AGENT_MODEL).toBe('claude')
    expect(parseConfig({ ...TEST_CONFIG, AGENT_MODEL: '' }).AGENT_MODEL).toBeUndefined()
    expect(parseConfig({ ...TEST_CONFIG, AGENT_MODEL: undefined }).AGENT_MODEL).toBeUndefined()
  })

  it('rejects missing or malformed values with a config error listing each issue', () => {
    const attempt = (): unknown =>
      parseConfig({ ...TEST_CONFIG, ALPACA_API_KEY: '', INTERNAL_TOKEN: 'short', SITE_URL: 'nope' })
    expect(attempt).toThrow(ConfigError)
    expect(attempt).toThrow(/^config: ALPACA_API_KEY .*; INTERNAL_TOKEN .*; SITE_URL /)
  })

  it('accepts the x group when all four keys are set', () => {
    expect(parseConfig({ ...TEST_CONFIG, ...X_CONFIG }).X_API_KEY).toBe('x-key')
  })

  it('rejects a partial x group', () => {
    expect(() => parseConfig({ ...TEST_CONFIG, X_API_KEY: 'only' })).toThrow(
      'config: set all of X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET or none (missing X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET)',
    )
  })

  it('accepts a full linkedin group and rejects a partial one', () => {
    expect(parseConfig({ ...TEST_CONFIG, ...LINKEDIN_CONFIG }).LINKEDIN_PERSON_URN).toBe(
      'urn:li:person:abc',
    )
    expect(() => parseConfig({ ...TEST_CONFIG, LINKEDIN_ACCESS_TOKEN: 'tok' })).toThrow(ConfigError)
  })
})

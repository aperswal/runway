import { describe, expect, it } from 'vitest'
import { loadConfig } from './env.ts'
import { ConfigError } from './errors.ts'

describe('loadConfig', () => {
  it('applies defaults when nothing is set', () => {
    expect(loadConfig({})).toEqual({ port: 9999, startCash: 1000, marketOpen: undefined })
  })

  it('treats blank values as unset', () => {
    expect(loadConfig({ MOCK_PORT: '', MOCK_START_CASH: '', MOCK_MARKET_OPEN: '' })).toEqual({
      port: 9999,
      startCash: 1000,
      marketOpen: undefined,
    })
  })

  it('parses explicit values', () => {
    expect(
      loadConfig({ MOCK_PORT: '8080', MOCK_START_CASH: '250.5', MOCK_MARKET_OPEN: 'true' }),
    ).toEqual({
      port: 8080,
      startCash: 250.5,
      marketOpen: true,
    })
    expect(loadConfig({ MOCK_MARKET_OPEN: 'false' }).marketOpen).toBe(false)
    expect(loadConfig({ MOCK_START_CASH: '0' }).startCash).toBe(0)
  })

  it('fails loudly on bad values', () => {
    expect(() => loadConfig({ MOCK_PORT: 'abc' })).toThrow(ConfigError)
    expect(() => loadConfig({ MOCK_PORT: '0' })).toThrow(ConfigError)
    expect(() => loadConfig({ MOCK_PORT: '1.5' })).toThrow(ConfigError)
    expect(() => loadConfig({ MOCK_START_CASH: '-1' })).toThrow(ConfigError)
    expect(() => loadConfig({ MOCK_PORT: 'abc', MOCK_MARKET_OPEN: 'maybe' })).toThrow(
      'config: MOCK_PORT Invalid input: expected number, received NaN; MOCK_MARKET_OPEN Invalid option: expected one of "true"|"false"',
    )
  })

  it('reads process.env by default', () => {
    expect(loadConfig().port).toBeGreaterThan(0)
  })
})

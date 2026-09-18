import { describe, expect, it } from 'vitest'
import { ConfigError, ExternalServiceError, InputError, StateError } from './errors'

describe('errors', () => {
  it('formats external service failures with service and status', () => {
    const error = new ExternalServiceError('alpaca', 503, 'down')
    expect(error.message).toBe('alpaca 503: down')
    expect(error.name).toBe('ExternalServiceError')
    expect(error.service).toBe('alpaca')
    expect(error.status).toBe(503)
    expect(error).toBeInstanceOf(Error)
  })

  it('names state and config errors', () => {
    expect(new StateError('stale').name).toBe('StateError')
    expect(new StateError('stale').message).toBe('stale')
    expect(new ConfigError('bad').name).toBe('ConfigError')
    expect(new ConfigError('bad').message).toBe('bad')
  })

  it('carries validation issues on input errors', () => {
    const error = new InputError('invalid', [{ path: ['a'] }])
    expect(error.name).toBe('InputError')
    expect(error.issues).toEqual([{ path: ['a'] }])
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorMessage, log } from './log'

describe('log', () => {
  afterEach(() => vi.restoreAllMocks())

  it('writes info events as json lines', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    log.info({ message: 'hi', n: 1 })
    expect(out).toHaveBeenCalledWith(JSON.stringify({ level: 'info', message: 'hi', n: 1 }))
  })

  it('writes error events to stderr', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    log.error({ message: 'boom' })
    expect(err).toHaveBeenCalledWith(JSON.stringify({ level: 'error', message: 'boom' }))
  })
})

describe('errorMessage', () => {
  it('uses the message of errors', () => expect(errorMessage(new Error('x'))).toBe('x'))
  it('stringifies anything else', () => expect(errorMessage(42)).toBe('42'))
})

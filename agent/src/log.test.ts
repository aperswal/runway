import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorMessage, log } from './log.ts'

afterEach(() => vi.restoreAllMocks())

describe('log', () => {
  it('writes info events to stdout as one JSON line', () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    log.info({ message: 'started', trigger: 'cron' })
    expect(out).toHaveBeenCalledWith('{"level":"info","message":"started","trigger":"cron"}')
  })
  it('writes error events to stderr', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    log.error({ message: 'failed' })
    expect(err).toHaveBeenCalledWith('{"level":"error","message":"failed"}')
  })
})

describe('errorMessage', () => {
  it('uses the message of an Error', () => expect(errorMessage(new Error('boom'))).toBe('boom'))
  it('stringifies anything else', () => expect(errorMessage(42)).toBe('42'))
})

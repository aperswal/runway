import { describe, expect, it } from 'vitest'
import { UsageError } from '../errors.ts'
import { intFlag, parseArgs, requireFlag } from './args.ts'

describe('parseArgs', () => {
  it('splits positionals from flag values', () =>
    expect(parseArgs(['reddit', 'search', '--q', 'a b', '--max', '5'])).toEqual({
      source: 'reddit',
      command: 'search',
      flags: { q: 'a b', max: '5' },
    }))
  it('accepts --name=value', () =>
    expect(parseArgs(['hn', 'search', '--q=nvidia']).flags).toEqual({ q: 'nvidia' }))
  it('keeps the positional after --name=value', () =>
    expect(parseArgs(['hn', '--q=nvidia', 'search'])).toEqual({
      source: 'hn',
      command: 'search',
      flags: { q: 'nvidia' },
    }))
  it('does not treat a flag value as a positional', () =>
    expect(parseArgs(['--q', 'x', 'hn', 'search'])).toEqual({
      source: 'hn',
      command: 'search',
      flags: { q: 'x' },
    }))
  it('defaults source and command to empty strings', () =>
    expect(parseArgs([])).toEqual({ source: '', command: '', flags: {} }))
  it('rejects a trailing flag without a value', () =>
    expect(() => parseArgs(['hn', '--q'])).toThrow(new UsageError('--q needs a value')))
  it('rejects a flag followed by another flag', () =>
    expect(() => parseArgs(['hn', '--q', '--max', '2'])).toThrow(UsageError))
})

describe('requireFlag', () => {
  it('returns the value', () => expect(requireFlag({ q: 'x' }, 'q')).toBe('x'))
  it('throws when missing', () =>
    expect(() => requireFlag({}, 'q')).toThrow(new UsageError('--q is required')))
  it('throws when empty', () => expect(() => requireFlag({ q: '' }, 'q')).toThrow(UsageError))
})

describe('intFlag', () => {
  it('falls back when absent', () => expect(intFlag({}, 'max', 7)).toBe(7))
  it('parses a positive integer', () => expect(intFlag({ max: '12' }, 'max', 7)).toBe(12))
  it('rejects text', () =>
    expect(() => intFlag({ max: 'lots' }, 'max', 7)).toThrow(
      new UsageError('--max must be a positive integer, got "lots"'),
    ))
  it('rejects zero', () => expect(() => intFlag({ max: '0' }, 'max', 7)).toThrow(UsageError))
  it('rejects fractions', () => expect(() => intFlag({ max: '2.5' }, 'max', 7)).toThrow(UsageError))
})

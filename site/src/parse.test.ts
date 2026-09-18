import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { InputError } from './errors'
import { parseBody } from './parse'

describe('parseBody', () => {
  it('returns parsed data or raises an input error', () => {
    expect(parseBody(z.object({ a: z.number() }), { a: 1 })).toEqual({ a: 1 })
    expect(() => parseBody(z.object({ a: z.number() }), {})).toThrow(InputError)
    expect(() => parseBody(z.object({ a: z.number() }), {})).toThrow('invalid input')
  })
})

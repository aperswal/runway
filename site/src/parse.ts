import type { z } from 'zod'
import { InputError } from './errors'

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new InputError('invalid input', parsed.error.issues)
  }
  return parsed.data
}

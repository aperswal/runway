import { describe, expect, it, vi } from 'vitest'

describe('worker module graph', () => {
  it('loads without throwing', async () => {
    vi.resetModules()
    const worker = await import('./index')
    expect(typeof worker.default.fetch).toBe('function')
    expect(typeof worker.default.scheduled).toBe('function')
    expect(typeof worker.default.queue).toBe('function')
  })
})

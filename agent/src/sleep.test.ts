import { describe, expect, it, vi } from 'vitest'
import { sleep } from './sleep.ts'

describe('sleep', () => {
  it('resolves after the given milliseconds', async () => {
    vi.useFakeTimers()
    let done = false
    void sleep(1000).then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(done).toBe(true)
    vi.useRealTimers()
  })
})

import { describe, expect, it } from 'vitest'
import { runJob } from './job.ts'

const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp' }

describe('runJob', () => {
  it('runs a script with only the given environment and captures both streams', async () => {
    const result = await runJob({
      script: 'echo out; echo err 1>&2; echo "site=$SITE_URL secret=$INTERNAL_TOKEN"',
      timeoutMs: 5000,
      env: { ...env, SITE_URL: 'https://s.test' },
    })
    expect(result.exitCode).toBe(0)
    expect(result.timedOut).toBe(false)
    expect(result.output).toContain('out\n')
    expect(result.output).toContain('err\n')
    expect(result.output).toContain('site=https://s.test secret=\n')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.durationMs).toBeLessThan(10_000)
  })
  it('clears the timer once the script exits so a stale kill never fires', async () => {
    const result = await runJob({ script: 'true', timeoutMs: 2000, env })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(result.timedOut).toBe(false)
  })
  it('reports the exit code', async () => {
    await expect(runJob({ script: 'exit 3', timeoutMs: 5000, env })).resolves.toMatchObject({
      exitCode: 3,
      timedOut: false,
    })
  })
  it('kills a script that outlives its timeout', async () => {
    const result = await runJob({
      script: "trap '' TERM; echo start; sleep 5; echo never",
      timeoutMs: 200,
      env,
    })
    expect(result.timedOut).toBe(true)
    expect(result.output).toContain('start')
    expect(result.output).not.toContain('never')
    expect(result.exitCode).toBeNull()
  })
  it('caps the output at twenty thousand characters', async () => {
    const result = await runJob({
      script: 'head -c 30000 /dev/zero | tr "\\0" x',
      timeoutMs: 5000,
      env,
    })
    expect(result.output).toHaveLength(20_000)
  })
  it('ignores chunks that arrive once the cap is already reached', async () => {
    const result = await runJob({
      script: 'head -c 25000 /dev/zero | tr "\\0" x; sleep 0.05; echo more',
      timeoutMs: 5000,
      env,
    })
    expect(result.output).toHaveLength(20_000)
    expect(result.output).not.toContain('more')
  })
})

describe('runJob spawn failure', () => {
  it('reports a shell that cannot start instead of hanging', async () => {
    const result = await runJob({ script: 'echo hi', timeoutMs: 30, env: { PATH: '/nonexistent' } })
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(result.exitCode).toBeNull()
    expect(result.durationMs).toBeLessThan(10_000)
    expect(result.output).toContain('spawn failed')
  })
})

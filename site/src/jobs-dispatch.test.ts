import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, resetDb, seedFund, testEnv, fakeAgent } from '../test/helpers'
import { jobs, notes } from './db/schema'
import { createJob } from './jobs'
import { executeJob, runDueJobs } from './jobs-dispatch'

const now = new Date('2026-09-15T12:00:00.000Z')
const input = {
  fund: 'social',
  name: 'funding',
  script: 'echo hi',
  everyMinutes: 60,
  runs: 2,
  timeoutSeconds: 120,
}

describe('executeJob', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })
  it('posts the script to a container named after the job and parses the result', async () => {
    const job = await createJob(db, input, now)
    const { agent, fetch, idFromName, destroy } = fakeAgent([
      { status: 200, body: '{"exitCode":0,"output":"ok","timedOut":false}' },
    ])
    await expect(executeJob(testEnv({ AGENT: agent }), job)).resolves.toEqual({
      exitCode: 0,
      output: 'ok',
      timedOut: false,
    })
    expect(idFromName).toHaveBeenCalledWith(`job-${job.id}`)
    expect(destroy).toHaveBeenCalledTimes(1)
    const request = fetch.mock.calls[0]![0]
    expect(request.url).toBe('http://agent/job')
    expect(request.headers.get('authorization')).toBe('Bearer internal-token-0123456789')
    expect(request.headers.get('content-type')).toBe('application/json')
    expect(await request.json()).toEqual({ script: 'echo hi', timeoutSeconds: 120 })
  })
  it('fails loudly on a bad status or shape', async () => {
    const job = await createJob(db, input, now)
    const failing = fakeAgent([{ status: 409, body: 'busy' }])
    await expect(executeJob(testEnv({ AGENT: failing.agent }), job)).rejects.toThrow(
      'job container 409: busy',
    )
    expect(failing.destroy).toHaveBeenCalledTimes(1)
    await expect(
      executeJob(testEnv({ AGENT: fakeAgent([{ status: 409, body: 'busy' }]).agent }), job),
    ).rejects.toThrow('job container 409: busy')
    await expect(
      executeJob(testEnv({ AGENT: fakeAgent([{ status: 200, body: '{"nope":1}' }]).agent }), job),
    ).rejects.toThrow('job container 200: unexpected shape: {"nope":1}')
  })
})

describe('runDueJobs', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })
  it('runs every due job, records outcomes, and keeps going after a failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const a = await createJob(db, { ...input, name: 'a' }, now)
    const b = await createJob(db, { ...input, name: 'b' }, now)
    await createJob(db, { ...input, name: 'later' }, new Date(now.getTime() + 60_000))
    const { agent } = fakeAgent([
      { status: 200, body: '{"exitCode":0,"output":"first","timedOut":false}' },
      { status: 500, body: 'boom' },
    ])
    await expect(runDueJobs(db, testEnv({ AGENT: agent }), now)).resolves.toBe(2)
    const rows = await db.select().from(jobs)
    expect(rows.find((j) => j.id === a.id)).toMatchObject({
      lastOutput: 'first',
      lastExitCode: 0,
      remainingRuns: 1,
    })
    expect(rows.find((j) => j.id === b.id)).toMatchObject({
      lastOutput: 'job failed: job container 500: boom',
      lastExitCode: null,
      remainingRuns: 1,
    })
    expect(rows.find((j) => j.name === 'later')?.lastRunAt).toBeNull()
    expect((await db.select().from(notes)).map((n) => n.title)).toEqual([
      'job: a (exit 0)',
      'job: b (exit none)',
    ])
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"message":"job failed"'))
    error.mockRestore()
  })
  it('runs at most three jobs at once', async () => {
    const pending: (() => void)[] = []
    let inFlight = 0
    let peak = 0
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          pending.push(() => {
            inFlight -= 1
            resolve(new Response('{"exitCode":0,"output":"ok","timedOut":false}'))
          })
        }),
    )
    const agent = {
      idFromName: vi.fn(() => 'id'),
      get: vi.fn(() => ({ fetch, destroy: vi.fn(() => Promise.resolve()) })),
    } as unknown as DurableObjectNamespace
    for (let i = 0; i < 5; i += 1) {
      await createJob(db, { ...input, name: `j${i}` }, now)
    }
    const run = runDueJobs(db, testEnv({ AGENT: agent }), now)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(inFlight).toBe(3)
    while (pending.length > 0) {
      pending.shift()?.()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await expect(run).resolves.toBe(5)
    expect(peak).toBe(3)
  })

  it('does nothing when nothing is due', async () => {
    await expect(runDueJobs(db, testEnv(), now)).resolves.toBe(0)
  })
})

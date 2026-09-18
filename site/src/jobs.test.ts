import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb, seedFund, stubDb } from '../test/helpers'
import { jobs, notes } from './db/schema'
import { GuardrailError } from './guardrails'
import { cancelJob, createJob, dueJobs, jobInput, listJobs, recordJobRun } from './jobs'

const now = new Date('2026-09-15T12:00:00.000Z')
const input = {
  fund: 'social',
  name: 'funding',
  script: 'echo hi',
  everyMinutes: 60,
  runs: 2,
  timeoutSeconds: 300,
}

describe('jobInput', () => {
  it('defaults the timeout and bounds the cadence and runs', () => {
    expect(
      jobInput.parse({ fund: 'social', name: ' f ', script: 'x', everyMinutes: 15, runs: 1 }),
    ).toEqual({
      fund: 'social',
      name: 'f',
      script: 'x',
      everyMinutes: 15,
      runs: 1,
      timeoutSeconds: 300,
    })
    expect(jobInput.safeParse({ ...input, everyMinutes: 14 }).success).toBe(false)
    expect(jobInput.safeParse({ ...input, everyMinutes: 1441 }).success).toBe(false)
    expect(jobInput.safeParse({ ...input, runs: 97 }).success).toBe(false)
    expect(jobInput.safeParse({ ...input, timeoutSeconds: 901 }).success).toBe(false)
    expect(jobInput.safeParse({ ...input, script: '' }).success).toBe(false)
  })
})

describe('jobs', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })
  it('creates a job that is due at once, lists and cancels it', async () => {
    const job = await createJob(db, input, now)
    expect(job).toMatchObject({
      fund: 'social',
      name: 'funding',
      remainingRuns: 2,
      status: 'active',
      nextRunAt: now.toISOString(),
      createdAt: now.toISOString(),
      lastRunAt: null,
    })
    expect(await listJobs(db, 'social')).toEqual([job])
    expect(await listJobs(db, 'other')).toEqual([])
    expect(await listJobs(db)).toHaveLength(1)
    expect(await dueJobs(db, now)).toEqual([job])
    expect(await dueJobs(db, new Date(now.getTime() - 1))).toEqual([])
    const cancelled = await cancelJob(db, job.id)
    expect(cancelled.status).toBe('cancelled')
    await expect(cancelJob(db, job.id)).rejects.toThrow(`unknown_job: no active job ${job.id}`)
    expect(await dueJobs(db, now)).toEqual([])
  })
  it('reports an insert that returned nothing', async () => {
    const fund = { id: 'social', status: 'active' }
    await expect(createJob(stubDb([[fund], [], []]), input, now)).rejects.toMatchObject({
      code: 'job_failed',
      message: 'job_failed: job insert returned nothing',
    })
  })
  it('refuses unknown funds and more than five active jobs', async () => {
    await expect(createJob(db, { ...input, fund: 'nope' }, now)).rejects.toThrow(GuardrailError)
    const first = await createJob(db, { ...input, name: 'j0' }, now)
    for (let i = 1; i < 5; i += 1) {
      await createJob(db, { ...input, name: `j${i}` }, now)
    }
    await expect(createJob(db, input, now)).rejects.toThrow(
      'too_many_jobs: social already has 5 active jobs; cancel one first',
    )
    await cancelJob(db, first.id)
    await expect(createJob(db, input, now)).resolves.toMatchObject({ status: 'active' })
  })
  it('records a run as a note, counts down, reschedules and retires', async () => {
    const job = await createJob(db, input, now)
    const first = await recordJobRun(
      db,
      job,
      { exitCode: 0, output: '  rate 0.01  ', timedOut: false },
      now,
    )
    expect(first).toMatchObject({
      remainingRuns: 1,
      status: 'active',
      lastRunAt: now.toISOString(),
      lastOutput: 'rate 0.01',
      lastExitCode: 0,
      nextRunAt: '2026-09-15T13:00:00.000Z',
    })
    const later = new Date('2026-09-15T13:00:00.000Z')
    const second = await recordJobRun(
      db,
      first,
      { exitCode: null, output: '', timedOut: true },
      later,
    )
    expect(second).toMatchObject({ remainingRuns: 0, status: 'done', lastExitCode: null })
    const saved = await db.select().from(notes)
    expect(saved.map((n) => [n.fund, n.title, n.body])).toEqual([
      ['social', 'job: funding (exit 0)', 'rate 0.01'],
      ['social', 'job: funding (timed out)', '(no output)'],
    ])
    expect(await dueJobs(db, new Date('2026-09-16T00:00:00.000Z'))).toEqual([])
  })
  it('caps stored output and names a missing exit code', async () => {
    const job = await createJob(db, { ...input, runs: 1 }, now)
    const row = await recordJobRun(
      db,
      job,
      { exitCode: null, output: 'x'.repeat(3000), timedOut: false },
      now,
    )
    expect(row.lastOutput).toHaveLength(2000)
    expect(row.remainingRuns).toBe(0)
    const [note] = await db.select().from(notes)
    expect(note?.title).toBe('job: funding (exit none)')
    await db.delete(jobs)
    await expect(
      recordJobRun(db, job, { exitCode: 1, output: 'late', timedOut: false }, now),
    ).rejects.toMatchObject({
      code: 'unknown_job',
      message: `unknown_job: job ${job.id} vanished during its run`,
    })
  })
})

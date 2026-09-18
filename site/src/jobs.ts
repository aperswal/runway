import { and, asc, eq, lte } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/client'
import { jobs, notes, type Job } from './db/schema'
import { requireActiveFund } from './funds'
import { GuardrailError } from './guardrails'
import { nowIso } from './time'

const MAX_NAME = 60
const MAX_SCRIPT = 4000
const MIN_EVERY_MINUTES = 15
const MAX_EVERY_MINUTES = 1440
const MAX_RUNS = 96
const MAX_TIMEOUT = 900
const DEFAULT_TIMEOUT = 300
const MAX_ACTIVE_PER_FUND = 5
const MS_PER_MINUTE = 60_000
const OUTPUT_KEPT = 2000

export const jobInput = z.object({
  fund: z.string().min(1),
  name: z.string().trim().min(1).max(MAX_NAME),
  script: z.string().min(1).max(MAX_SCRIPT),
  everyMinutes: z.number().int().min(MIN_EVERY_MINUTES).max(MAX_EVERY_MINUTES),
  runs: z.number().int().positive().max(MAX_RUNS),
  timeoutSeconds: z.number().int().positive().max(MAX_TIMEOUT).default(DEFAULT_TIMEOUT),
})
export type JobInput = z.infer<typeof jobInput>
export const jobsQuery = z.object({ fund: z.string().optional() })
export type JobResult = { exitCode: number | null; output: string; timedOut: boolean }

export async function createJob(db: Db, input: JobInput, now: Date): Promise<Job> {
  await requireActiveFund(db, input.fund)
  const active = await listJobs(db, input.fund)
  if (active.filter((j) => j.status === 'active').length >= MAX_ACTIVE_PER_FUND) {
    throw new GuardrailError(
      'too_many_jobs',
      `${input.fund} already has ${MAX_ACTIVE_PER_FUND} active jobs; cancel one first`,
    )
  }
  const { runs, ...rest } = input
  const [row] = await db
    .insert(jobs)
    .values({
      ...rest,
      remainingRuns: runs,
      status: 'active',
      nextRunAt: now.toISOString(),
      createdAt: now.toISOString(),
    })
    .returning()
  if (row === undefined) {
    throw new GuardrailError('job_failed', 'job insert returned nothing')
  }
  return row
}

export function listJobs(db: Db, fund?: string): Promise<Job[]> {
  return db
    .select()
    .from(jobs)
    .where(fund === undefined ? undefined : eq(jobs.fund, fund))
    .orderBy(asc(jobs.id))
}

export async function cancelJob(db: Db, id: number): Promise<Job> {
  const [row] = await db
    .update(jobs)
    .set({ status: 'cancelled' })
    .where(and(eq(jobs.id, id), eq(jobs.status, 'active')))
    .returning()
  if (row === undefined) {
    throw new GuardrailError('unknown_job', `no active job ${id}`)
  }
  return row
}

export function dueJobs(db: Db, now: Date): Promise<Job[]> {
  return db
    .select()
    .from(jobs)
    .where(and(eq(jobs.status, 'active'), lte(jobs.nextRunAt, now.toISOString())))
    .orderBy(asc(jobs.nextRunAt))
}

export async function recordJobRun(db: Db, job: Job, result: JobResult, now: Date): Promise<Job> {
  const remaining = job.remainingRuns - 1
  const status = remaining <= 0 ? 'done' : 'active'
  const summary = result.timedOut ? 'timed out' : `exit ${result.exitCode ?? 'none'}`
  const output = result.output.trim().slice(0, OUTPUT_KEPT)
  await db.insert(notes).values({
    fund: job.fund,
    title: `job: ${job.name} (${summary})`,
    body: output.length === 0 ? '(no output)' : output,
    createdAt: nowIso(),
  })
  const [row] = await db
    .update(jobs)
    .set({
      remainingRuns: Math.max(0, remaining),
      status,
      lastRunAt: now.toISOString(),
      lastOutput: output,
      lastExitCode: result.exitCode,
      nextRunAt: new Date(now.getTime() + job.everyMinutes * MS_PER_MINUTE).toISOString(),
    })
    .where(eq(jobs.id, job.id))
    .returning()
  if (row === undefined) {
    throw new GuardrailError('unknown_job', `job ${job.id} vanished during its run`)
  }
  return row
}

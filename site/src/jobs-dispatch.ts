import { getContainer } from '@cloudflare/containers'
import { z } from 'zod'
import type { Db } from './db/client'
import type { Job } from './db/schema'
import { parseConfig, type Bindings } from './env'
import { ExternalServiceError } from './errors'
import { dueJobs, recordJobRun, type JobResult } from './jobs'
import { errorMessage, log } from './log'

const resultSchema = z.object({
  exitCode: z.number().nullable(),
  output: z.string(),
  timedOut: z.boolean(),
})
const HTTP_OK = 200
const MAX_CONCURRENT_JOBS = 3

export async function executeJob(
  env: Bindings & Record<string, unknown>,
  job: Job,
): Promise<JobResult> {
  const config = parseConfig(env)
  const container = getContainer(env.AGENT, `job-${job.id}`)
  try {
    return await runInContainer(container, config.INTERNAL_TOKEN, job)
  } finally {
    await container.destroy()
  }
}

async function runInContainer(
  container: ReturnType<typeof getContainer>,
  token: string,
  job: Job,
): Promise<JobResult> {
  const res = await container.fetch(
    new Request('http://agent/job', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ script: job.script, timeoutSeconds: job.timeoutSeconds }),
    }),
  )
  const body = await res.text()
  if (res.status !== HTTP_OK) {
    throw new ExternalServiceError('job container', res.status, body)
  }
  const parsed = resultSchema.safeParse(JSON.parse(body))
  if (!parsed.success) {
    throw new ExternalServiceError('job container', res.status, `unexpected shape: ${body}`)
  }
  return parsed.data
}

export async function runDueJobs(
  db: Db,
  env: Bindings & Record<string, unknown>,
  now: Date,
): Promise<number> {
  const due = await dueJobs(db, now)
  await runWithLimit(due, MAX_CONCURRENT_JOBS, (job) => runOneJob(db, env, job, now))
  return due.length
}

async function runOneJob(
  db: Db,
  env: Bindings & Record<string, unknown>,
  job: Job,
  now: Date,
): Promise<void> {
  try {
    await recordJobRun(db, job, await executeJob(env, job), now)
  } catch (error) {
    log.error({ message: 'job failed', jobId: job.id, error: errorMessage(error) })
    await recordJobRun(
      db,
      job,
      { exitCode: null, output: `job failed: ${errorMessage(error)}`, timedOut: false },
      now,
    )
  }
}

async function runWithLimit<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items]
  const workerCount = Math.min(limit, queue.length)
  await Promise.all(Array.from({ length: workerCount }, () => drain(queue, task)))
}

async function drain<T>(queue: T[], task: (item: T) => Promise<void>): Promise<void> {
  let item = queue.shift()
  while (item !== undefined) {
    await task(item)
    item = queue.shift()
  }
}

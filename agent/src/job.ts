import { spawn } from 'node:child_process'
import os from 'node:os'

export type JobRequest = { script: string; timeoutMs: number; env: Record<string, string> }
export type JobResult = {
  exitCode: number | null
  output: string
  timedOut: boolean
  durationMs: number
}

const MAX_OUTPUT = 20_000

export function runJob(job: JobRequest): Promise<JobResult> {
  return new Promise((resolve) => {
    const started = Date.now()
    let output = ''
    let timedOut = false
    const child = spawn('bash', ['-c', job.script], {
      cwd: os.tmpdir(),
      env: job.env,
      detached: true,
    })
    const collect = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(0, MAX_OUTPUT)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => {
      timedOut = true
      process.kill(-Number(child.pid), 'SIGKILL')
    }, job.timeoutMs)
    child.on('error', (error) => {
      resolve({
        exitCode: null,
        output: `spawn failed: ${error.message}`,
        timedOut,
        durationMs: Date.now() - started,
      })
    })
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, output, timedOut, durationMs: Date.now() - started })
    })
  })
}

import http from 'node:http'
import { agentEnv, loadConfig } from './env.ts'
import { errorMessage, log } from './log.ts'
import { runJob, type JobResult } from './job.ts'
import { runAgent, runOneManager, type QueryOutcome } from './run.ts'
import { SiteClient } from './site.ts'
import { z } from 'zod'

const PORT = 8080
const HTTP = {
  ok: 200,
  accepted: 202,
  badRequest: 400,
  unauthorized: 401,
  notFound: 404,
  conflict: 409,
} as const
const MAX_JOB_SECONDS = 900
const DEFAULT_JOB_SECONDS = 300
const MS_PER_SECOND = 1000
const BEARER = 'Bearer '
const POST_ROUTES = new Set(['/run', '/job', '/manager'])

export type ServerState = { running: boolean; stopping: boolean }
type Runner = (trigger: string) => Promise<unknown>
type ManagerRunner = (fund: string, trigger: string, codexAuth?: string) => Promise<QueryOutcome>
type Reporter = (fund: string, key: string, outcome: QueryOutcome) => Promise<unknown>
type Runtime = {
  token: string
  siteUrl: string
  state: ServerState
  run: Runner
  manager: ManagerRunner
  report: Reporter
  jobEnv: Record<string, string>
}

export function createServer(
  config = loadConfig(),
  run: Runner = runAgent,
  manager: ManagerRunner = (fund, trigger, codexAuth) =>
    runOneManager(fund, trigger, config, codexAuth),
  report: Reporter = (fund, key, outcome) =>
    new SiteClient(config.SITE_URL, config.INTERNAL_TOKEN).report(fund, key, outcome),
): { server: http.Server; state: ServerState } {
  const state: ServerState = { running: false, stopping: false }
  const jobEnv = agentEnv(config)
  const runtime = {
    token: config.INTERNAL_TOKEN,
    siteUrl: config.SITE_URL,
    state,
    run,
    manager,
    report,
    jobEnv,
  }
  const server = http.createServer((req, res) => {
    void handle(req, res, runtime)
  })
  return { server, state }
}

async function handle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  runtime: Runtime,
): Promise<void> {
  if (req.method === 'GET' && req.url === '/health') {
    const site = await probeSite(runtime.siteUrl)
    respond(res, HTTP.accepted, { ok: true, siteUrl: runtime.siteUrl, site, ...runtime.state })
    return
  }
  const refusal = refuse(req, runtime.token)
  if (refusal !== null) {
    respond(res, refusal.status, { error: refusal.error })
    return
  }
  if (req.url === '/job') {
    await handleJob(req, res, runtime.jobEnv)
    return
  }
  if (req.url === '/manager') {
    await handleManager(req, res, runtime)
    return
  }
  await startRun(req, res, runtime)
}

function refuse(
  req: http.IncomingMessage,
  token: string,
): { status: number; error: string } | null {
  if (req.method !== 'POST' || !POST_ROUTES.has(String(req.url))) {
    return { status: HTTP.notFound, error: 'not found' }
  }
  if (req.headers.authorization !== `${BEARER}${token}`) {
    return { status: HTTP.unauthorized, error: 'unauthorized' }
  }
  return null
}

async function startRun(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  runtime: Runtime,
): Promise<void> {
  if (runtime.state.running) {
    respond(res, HTTP.conflict, { error: 'run in progress' })
    return
  }
  const trigger = await readTrigger(req)
  respond(res, HTTP.accepted, { started: trigger })
  await execute(runtime, trigger)
}

async function execute(runtime: Runtime, trigger: string): Promise<void> {
  runtime.state.running = true
  try {
    log.info({ message: 'run started', trigger })
    await runtime.run(trigger)
    log.info({ message: 'run finished', trigger })
  } catch (error) {
    log.error({ message: 'run failed', trigger, error: errorMessage(error) })
  } finally {
    runtime.state.running = false
  }
}

const PROBE_TIMEOUT_MS = 8000

async function probeSite(siteUrl: string): Promise<string> {
  try {
    const res = await fetch(`${siteUrl}/api/summary`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    return `status ${res.status}`
  } catch (error) {
    return `error: ${errorMessage(error)}`
  }
}

type JobBody = { script: string; timeoutSeconds: number }

const jobSchema = z.object({
  script: z.string(),
  timeoutSeconds: z.number().catch(DEFAULT_JOB_SECONDS).default(DEFAULT_JOB_SECONDS),
})

export function parseJob(raw: string): JobBody | null {
  if (raw.length === 0) {
    return null
  }
  const parsed = jobSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) {
    return null
  }
  const seconds = Math.min(MAX_JOB_SECONDS, Math.max(1, parsed.data.timeoutSeconds))
  return { script: parsed.data.script, timeoutSeconds: seconds }
}

async function handleJob(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  env: Record<string, string>,
): Promise<void> {
  const job = parseJob(await readBody(req))
  if (job === null) {
    respond(res, HTTP.badRequest, { error: 'body must be {script, timeoutSeconds?}' })
    return
  }
  log.info({ message: 'job started', timeoutSeconds: job.timeoutSeconds })
  const result: JobResult = await runJob({
    script: job.script,
    timeoutMs: job.timeoutSeconds * MS_PER_SECOND,
    env,
  })
  log.info({
    message: 'job finished',
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  })
  respond(res, HTTP.ok, result)
}

const managerSchema = z.object({
  fund: z.string().min(1),
  trigger: z.string().min(1),
  key: z.string().min(1),
  codexAuth: z.string().min(1).optional(),
})

async function handleManager(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  runtime: Runtime,
): Promise<void> {
  const parsed = managerSchema.safeParse(JSON.parse(await readBody(req)))
  if (!parsed.success) {
    respond(res, HTTP.badRequest, { error: 'body must be {fund, trigger, key}' })
    return
  }
  const { fund, trigger, key, codexAuth } = parsed.data
  respond(res, HTTP.accepted, { started: fund })
  const engine = codexAuth === undefined ? 'claude' : 'codex'
  log.info({ message: 'manager started', fund, trigger, engine })
  try {
    const outcome = await runtime.manager(fund, trigger, codexAuth)
    await runtime.report(fund, key, outcome)
    log.info({ message: 'manager reported', fund, error: outcome.error })
  } catch (error) {
    log.error({ message: 'manager failed', fund, error: errorMessage(error) })
  }
}

function respond(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString()
}

export async function readTrigger(req: http.IncomingMessage): Promise<string> {
  const raw = await readBody(req)
  return raw.length === 0 ? 'http' : triggerFrom(JSON.parse(raw))
}

function triggerFrom(parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null || !('trigger' in parsed)) {
    return 'http'
  }
  return typeof parsed.trigger === 'string' && parsed.trigger.length > 0 ? parsed.trigger : 'http'
}

export function start(): void {
  const { server, state } = createServer()
  server.listen(PORT, () => {
    log.info({ message: `agent listening on ${PORT}` })
  })
  process.on('SIGTERM', () => {
    state.stopping = true
    server.close()
    if (!state.running) {
      process.exit(0)
    }
    log.info({ message: 'SIGTERM received, finishing the current run' })
  })
}

import { Container } from '@cloudflare/containers'
import { startAgentRun } from './agent-trigger'
import { app } from './app'
import { refreshCodexAuth } from './codex-auth'
import { buildDeps } from './deps'
import { closeMonth, previousMonth } from './distributions'
import { parseConfig, type Bindings, type Config, type PostJob } from './env'
import { runCycle } from './exits'
import { runDueJobs } from './jobs-dispatch'
import { errorMessage, log } from './log'
import { markDueMonitors } from './monitors'
import { publishTrade } from './publish'
import { rewritePending } from './rewrite'
import { MONTH_CLOSE_CRON, SNAPSHOT_CRON } from './schedule'

export { Ticker } from './ticker'

const AGENT_PORT = 8080
const RETRY_BASE_SECONDS = 60
const RETRY_MAX_SECONDS = 3600
const RETRY_FACTOR = 2

type Env = Bindings & Record<string, unknown>

async function handleCron(cron: string, env: Env): Promise<void> {
  if (cron === SNAPSHOT_CRON) {
    const deps = buildDeps(env)
    await runCycle(deps)
    await markDueMonitors(deps.db, new Date())
    await runDueJobs(deps.db, env, new Date())
    await rewritePending(deps.db, deps.config)
    await refreshCodexAuth(deps.db, new Date())
    return
  }
  if (cron === MONTH_CLOSE_CRON) {
    const deps = buildDeps(env)
    await closeMonth(deps.db, deps.summary, previousMonth(new Date()))
    return
  }
  await startAgentRun(env, cron)
}

const SOURCE_KEYS = [
  'CODEX_MODEL',
  'RESEARCH_TOKEN',
  'APIFY_TOKEN',
  'YOUTUBE_API_KEY',
  'REDDIT_CLIENT_ID',
  'REDDIT_CLIENT_SECRET',
  'OPENAI_API_KEY',
] as const

export const containerEnv = (config: Config): Record<string, string> => ({
  SITE_URL: config.SITE_URL,
  INTERNAL_TOKEN: config.INTERNAL_TOKEN,
  DATA_TOKEN: config.DATA_TOKEN,
  CLAUDE_CODE_OAUTH_TOKEN: config.CLAUDE_CODE_OAUTH_TOKEN ?? '',
  AGENT_MODEL: config.AGENT_MODEL ?? '',
  MANAGER_MODEL: config.MANAGER_MODEL ?? '',
  ...Object.fromEntries(
    SOURCE_KEYS.flatMap((k) => (config[k] === undefined ? [] : [[k, config[k]]])),
  ),
})

export class AgentContainer extends Container<Env> {
  defaultPort = AGENT_PORT
  sleepAfter = '45m'

  constructor(...args: ConstructorParameters<typeof Container<Env>>) {
    super(...args)
    const config = parseConfig(args[1])
    this.envVars = containerEnv(config)
  }
}

export const retryDelaySeconds = (attempts: number): number =>
  Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * RETRY_FACTOR ** attempts)

export default {
  fetch: app.fetch,
  scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      handleCron(event.cron, env).catch((error: unknown) => {
        log.error({ message: 'cron failed', cron: event.cron, error: errorMessage(error) })
        throw error
      }),
    )
  },
  async queue(batch: MessageBatch<PostJob>, env: Env): Promise<void> {
    const { db, config } = buildDeps(env)
    for (const message of batch.messages) {
      const failures = await publishTrade(db, config, message.body)
      if (failures.length === 0) {
        message.ack()
        continue
      }
      log.error({ message: 'post failed', job: message.body, failures })
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) })
    }
  },
}

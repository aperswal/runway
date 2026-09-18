import { query, type Options, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import os from 'node:os'
import { CIO_TOOL_NAMES, cioServer } from './cio-tools.ts'
import { CODEX_MINUTES, runCodex } from './codex.ts'
import { agentEnv, loadConfig, loadMcpServers, type AgentConfig } from './env.ts'
import { JOB_TOOL_NAMES, jobServer } from './job-tools.ts'
import { errorMessage, log } from './log.ts'
import { mcpToolNames, type McpServers } from './mcp.ts'
import { MONITOR_TOOL_NAMES, monitorServer } from './monitor-tools.ts'
import { cioPrompt, managerPrompt } from './prompt.ts'
import { RESEARCH_TOOL_NAMES, researchServer } from './research-tools.ts'
import { SiteClient, type FundRecord, type RunReport } from './site.ts'
import { READ_TOOL_NAMES, TOOL_NAMES, traderReadServer, traderServer } from './tools.ts'
import { summaryOf, toReport, withToolFailures } from './report.ts'

const RESEARCH_BUILTINS = ['WebSearch', 'WebFetch', 'Bash']
const CIO_BUILTINS = ['WebSearch', 'WebFetch']
const MANAGER_TOOLS = [
  ...RESEARCH_BUILTINS,
  ...TOOL_NAMES,
  ...RESEARCH_TOOL_NAMES,
  ...JOB_TOOL_NAMES,
  ...MONITOR_TOOL_NAMES,
]
const CIO_TOOLS = [...CIO_BUILTINS, ...CIO_TOOL_NAMES, ...READ_TOOL_NAMES, ...RESEARCH_TOOL_NAMES]
const DEFAULT_MANAGER_MODEL = 'claude-sonnet-5'
const MAX_ERROR_TEXT = 300

export type QueryOutcome = {
  result: SDKResultMessage | undefined
  error: string | null
  seen: string[]
}

function baseOptions(config: AgentConfig): Options {
  return {
    ...(config.AGENT_MODEL === undefined ? {} : { model: config.AGENT_MODEL }),
    cwd: os.tmpdir(),
    maxTurns: config.AGENT_MAX_TURNS,
    permissionMode: 'dontAsk',
    env: {
      ...agentEnv(config),
      ...(config.CLAUDE_CODE_OAUTH_TOKEN === undefined
        ? {}
        : { CLAUDE_CODE_OAUTH_TOKEN: config.CLAUDE_CODE_OAUTH_TOKEN }),
    },
  }
}

export function managerOptions(
  config: AgentConfig,
  site: SiteClient,
  fund: FundRecord,
  external: McpServers = {},
): Options {
  return {
    ...baseOptions(config),
    model: config.MANAGER_MODEL ?? DEFAULT_MANAGER_MODEL,
    systemPrompt: managerPrompt(fund, { turns: config.AGENT_MAX_TURNS }),
    tools: RESEARCH_BUILTINS,
    allowedTools: [...MANAGER_TOOLS, ...mcpToolNames(external)],
    mcpServers: {
      ...external,
      trader: traderServer(site),
      research: researchServer(site),
      jobs: jobServer(site),
      monitors: monitorServer(site),
    },
  }
}

export function cioOptions(
  config: AgentConfig,
  site: SiteClient,
  funds: FundRecord[],
  external: McpServers = {},
): Options {
  return {
    ...baseOptions(config),
    systemPrompt: cioPrompt(funds, { turns: config.AGENT_MAX_TURNS }),
    tools: CIO_BUILTINS,
    allowedTools: [...CIO_TOOLS, ...mcpToolNames(external)],
    mcpServers: {
      ...external,
      cio: cioServer(site),
      trader: traderReadServer(site),
      research: researchServer(site),
    },
  }
}

type ManagerDeps = { config: AgentConfig; site: SiteClient; external: McpServers }

export function runManager(
  context: string,
  fund: FundRecord,
  deps: ManagerDeps,
  codexAuth?: string,
): Promise<QueryOutcome> {
  if (codexAuth === undefined) {
    return runQuery(context, managerOptions(deps.config, deps.site, fund, deps.external))
  }
  const research = deps.config.RESEARCH_TOKEN ?? deps.config.INTERNAL_TOKEN
  return runCodex(
    {
      prompt: context,
      instructions: managerPrompt(fund, { minutes: CODEX_MINUTES }),
      auth: codexAuth,
      config: deps.config,
      tokens: { research },
    },
    agentEnv(deps.config),
  )
}

export async function runOneManager(
  fundId: string,
  trigger: string,
  config: AgentConfig = loadConfig(),
  codexAuth?: string,
): Promise<QueryOutcome> {
  const site = new SiteClient(config.SITE_URL, config.INTERNAL_TOKEN)
  const [context, funds] = await Promise.all([site.context(trigger, fundId), site.funds()])
  const fund = funds.find((f) => f.id === fundId && f.status === 'active')
  if (fund === undefined) {
    return { result: undefined, error: `no active fund ${fundId}`, seen: [] }
  }
  const deps = { config, site, external: loadMcpServers(config) }
  return runManager(context, fund, deps, codexAuth)
}

export async function runQuery(prompt: string, options: Options): Promise<QueryOutcome> {
  const outcome: QueryOutcome = { result: undefined, error: null, seen: [] }
  try {
    for await (const message of query({ prompt, options })) {
      if (message.type === 'result') {
        outcome.result = message
      }
      outcome.seen.push(...toolResultErrors(message))
    }
  } catch (caught) {
    outcome.error = errorMessage(caught)
  }
  return outcome
}

export async function runAgent(
  trigger: string,
  config: AgentConfig = loadConfig(),
): Promise<RunReport> {
  const site = new SiteClient(config.SITE_URL, config.INTERNAL_TOKEN)
  const startedAt = new Date().toISOString()
  const [context, funds] = await Promise.all([site.context(trigger), site.funds()])
  const external = loadMcpServers(config)
  const active = funds.filter((f) => f.status === 'active')
  const managers = await Promise.all(
    active.map(async (fund) => ({ fund, outcome: await dispatchManager(site, fund.id, trigger) })),
  )
  const reports = managers.map((m) => `## ${m.fund.id}\n${summaryOf(m.outcome)}`).join('\n\n')
  const cio = await runQuery(
    `${context}\n\n# Manager reports\n\n${reports}`,
    cioOptions(config, site, funds, external),
  )
  const outcomes = [...managers.map((m) => m.outcome), cio]
  const report = withToolFailures(
    toReport(trigger, startedAt, outcomes),
    outcomes.flatMap((o) => o.seen),
  )
  await site.recordRun(report)
  return report
}

async function dispatchManager(
  site: SiteClient,
  fund: string,
  trigger: string,
): Promise<QueryOutcome> {
  try {
    return await site.manager(fund, trigger)
  } catch (error) {
    const message = errorMessage(error)
    log.error({ message: 'manager dispatch failed', fund, error: message })
    return { result: undefined, error: `manager ${fund}: ${message}`, seen: [] }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const textOf = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((block: unknown) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
    .join(' ')
}

export function toolResultErrors(message: unknown): string[] {
  if (!isRecord(message) || message.type !== 'user' || !isRecord(message.message)) {
    return []
  }
  const content = message.message.content
  if (!Array.isArray(content)) {
    return []
  }
  return content
    .filter(
      (block: unknown): block is Record<string, unknown> =>
        isRecord(block) && block.type === 'tool_result' && block.is_error === true,
    )
    .map((block) => `model saw: ${textOf(block.content).slice(0, MAX_ERROR_TEXT)}`)
}

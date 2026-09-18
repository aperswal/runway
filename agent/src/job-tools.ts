import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { SiteClient } from './site.ts'
import { attempt, type ToolList } from './tools.ts'

const MAX_NAME = 60
const MAX_SCRIPT = 4000
const MIN_EVERY_MINUTES = 15
const MAX_EVERY_MINUTES = 1440
const MAX_RUNS = 96
const MAX_TIMEOUT = 900

const scheduleShape = {
  fund: z.string(),
  name: z
    .string()
    .max(MAX_NAME)
    .describe('what the job collects, e.g. "BTC funding rate every hour"'),
  script: z
    .string()
    .max(MAX_SCRIPT)
    .describe(
      'bash script; python3, node, curl and the sources CLI are available; it sees SITE_URL and DATA_TOKEN only; print the findings to stdout',
    ),
  everyMinutes: z.number().int().min(MIN_EVERY_MINUTES).max(MAX_EVERY_MINUTES),
  runs: z
    .number()
    .int()
    .positive()
    .max(MAX_RUNS)
    .describe('how many times to run before the job retires'),
  timeoutSeconds: z.number().int().positive().max(MAX_TIMEOUT).optional(),
}
const listShape = { fund: z.string() }
const cancelShape = { id: z.number().int().positive() }

function scheduleTool(site: SiteClient): SdkMcpToolDefinition<typeof scheduleShape> {
  return tool(
    'schedule_job',
    'Leave a script running on a cadence in its own sandboxed container. Each run output is saved as a note on your fund, so you can collect data between runs (funding rates, review counts, prices, anything a script can fetch).',
    scheduleShape,
    (input) => attempt(() => site.createJob(input)),
  )
}

function listTool(site: SiteClient): SdkMcpToolDefinition<typeof listShape> {
  return tool(
    'list_jobs',
    'List the fund scheduled jobs with their last output and remaining runs.',
    listShape,
    (input) => attempt(() => site.listJobs(input.fund)),
  )
}

function cancelTool(site: SiteClient): SdkMcpToolDefinition<typeof cancelShape> {
  return tool('cancel_job', 'Stop a scheduled job.', cancelShape, (input) =>
    attempt(() => site.cancelJob(input.id)),
  )
}

export const jobTools = (site: SiteClient): ToolList => [
  scheduleTool(site),
  listTool(site),
  cancelTool(site),
]

export function jobServer(site: SiteClient): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'jobs',
    tools: jobTools(site),
  })
}

export const JOB_TOOL_NAMES = [
  'mcp__jobs__schedule_job',
  'mcp__jobs__list_jobs',
  'mcp__jobs__cancel_job',
]

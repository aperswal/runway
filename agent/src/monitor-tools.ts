import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { SiteClient } from './site.ts'
import { attempt, type ToolList } from './tools.ts'

const MAX_SHORT = 120
const MAX_LONG = 1000

const setShape = {
  fund: z.string(),
  symbol: z.string(),
  event: z
    .string()
    .max(MAX_SHORT)
    .describe('earnings, FDA decision, product launch, contract award, unlock, ...'),
  eventAt: z.string().describe('ISO 8601 UTC datetime of the event'),
  watch: z
    .string()
    .max(MAX_LONG)
    .describe(
      'what to check and what you will do either way, e.g. "guide above $1.2B: hold to target; miss: close"',
    ),
}
const listShape = { fund: z.string() }
const resolveShape = {
  id: z.number().int().positive(),
  outcome: z.string().max(MAX_LONG).describe('what happened and what you did'),
}

function setTool(site: SiteClient): SdkMcpToolDefinition<typeof setShape> {
  return tool(
    'set_monitor',
    'Watch a dated event (earnings, FDA, launch). The monitor is flagged DUE in your context once the time passes, and shown on the public Stats page under Watching.',
    setShape,
    (input) => attempt(() => site.createMonitor(input)),
  )
}

function listTool(site: SiteClient): SdkMcpToolDefinition<typeof listShape> {
  return tool('list_monitors', 'List the fund monitors with their status.', listShape, (input) =>
    attempt(() => site.listMonitors(input.fund)),
  )
}

function resolveTool(site: SiteClient): SdkMcpToolDefinition<typeof resolveShape> {
  return tool(
    'resolve_monitor',
    'Close a monitor once you have acted on the event, recording the outcome.',
    resolveShape,
    (input) => attempt(() => site.resolveMonitor(input.id, input.outcome)),
  )
}

export const monitorTools = (site: SiteClient): ToolList => [
  setTool(site),
  listTool(site),
  resolveTool(site),
]

export function monitorServer(site: SiteClient): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'monitors',
    tools: monitorTools(site),
  })
}

export const MONITOR_TOOL_NAMES = [
  'mcp__monitors__set_monitor',
  'mcp__monitors__list_monitors',
  'mcp__monitors__resolve_monitor',
]

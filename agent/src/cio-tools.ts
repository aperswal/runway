import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { SiteClient } from './site.ts'
import { attempt } from './tools.ts'

const MAX_NAME = 60
const MAX_MANDATE = 1500
const MAX_REASON = 120

const createShape = {
  id: z.string().describe('lowercase slug, e.g. ai-capex'),
  name: z.string().max(MAX_NAME),
  mandate: z.string().max(MAX_MANDATE).describe('the strategy brief its manager will run'),
  share: z
    .number()
    .positive()
    .max(1)
    .describe('fraction of equity it may deploy; all active funds must sum to at most 1'),
}
const shareShape = { id: z.string(), share: z.number().positive().max(1) }
const retireShape = { id: z.string(), reason: z.string().max(MAX_REASON) }

function createFundTool(site: SiteClient): SdkMcpToolDefinition<typeof createShape> {
  return tool(
    'create_fund',
    'Spin up a new fund with its own mandate and capital share. Its manager agent exists from the next run.',
    createShape,
    (input) => attempt(() => site.createFund(input)),
  )
}

function reallocateFundTool(site: SiteClient): SdkMcpToolDefinition<typeof shareShape> {
  return tool(
    'reallocate_fund',
    "Reset a fund's book to this fraction of equity. Its high water mark resets too; the drawdown rules keep applying from there.",
    shareShape,
    (input) => attempt(() => site.reallocateFund(input.id, input.share)),
  )
}

function retireFundTool(site: SiteClient): SdkMcpToolDefinition<typeof retireShape> {
  return tool(
    'retire_fund',
    'Spin a fund down. It must hold no positions; close them first.',
    retireShape,
    (input) => attempt(() => site.retireFund(input.id, input.reason)),
  )
}

export function cioServer(site: SiteClient): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'cio',
    tools: [createFundTool(site), reallocateFundTool(site), retireFundTool(site)],
  })
}

export const CIO_TOOL_NAMES = [
  'mcp__cio__create_fund',
  'mcp__cio__reallocate_fund',
  'mcp__cio__retire_fund',
]

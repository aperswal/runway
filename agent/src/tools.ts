import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { SiteError } from './errors.ts'
import { errorMessage } from './log.ts'
import type { SiteClient } from './site.ts'

export const MAX_OPENS_PER_FUND = 5
const MAX_HORIZON = 40
const MAX_REASON = 150
const MAX_CONTRACTS = 500
const MAX_ALIVE_HOURS = 168
const DEFAULT_CONTRACTS = 100

const MAX_HISTORY = 500
const MAX_TRAIL_PCT = 50

const openShape = {
  fund: z.string().describe('your fund id'),
  symbol: z.string().describe('AAPL or BTC/USD'),
  notional: z
    .number()
    .positive()
    .optional()
    .describe('dollars to spend with a market order (give notional or qty, not both)'),
  qty: z
    .number()
    .positive()
    .optional()
    .describe('shares or coins to buy; required for limit orders'),
  limit: z
    .number()
    .positive()
    .optional()
    .describe(
      'queue a limit order at this price instead of buying at market; whole-share limit orders also work in pre-market, after-hours and overnight sessions',
    ),
  aliveHours: z
    .number()
    .positive()
    .max(MAX_ALIVE_HOURS)
    .optional()
    .describe(
      'how long a queued limit order stays alive (default 24, max 168); it is re-placed each session until then',
    ),
  stop: z.number().positive().describe('sell if price drops to this'),
  target: z.number().positive().describe('sell if price rises to this'),
  trailPct: z
    .number()
    .positive()
    .max(MAX_TRAIL_PCT)
    .optional()
    .describe(
      'trailing stop: every 15 minutes the venue raises the stop to this percentage below the latest price, never lowers it',
    ),
  horizon: z.string().max(MAX_HORIZON).describe('expected time to profitability, e.g. "3 weeks"'),
  reason: z.string().max(MAX_REASON).describe('one sentence, published verbatim'),
}
const closeShape = {
  fund: z.string().describe('your fund id; only a lot held by this fund is sold'),
  symbol: z.string(),
  reason: z.string().max(MAX_REASON).describe('one sentence, published verbatim'),
  fraction: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe('sell only this fraction of the lot (take partial profit); omit to sell all'),
}
const cancelShape = {
  fund: z.string().describe('your fund id; only an order queued by this fund is withdrawn'),
  symbol: z.string(),
  reason: z.string().max(MAX_REASON).describe('why the queued order is withdrawn'),
}
const contractsShape = {
  underlying: z.string().describe('underlying stock symbol, e.g. AAPL'),
  type: z.enum(['call', 'put']).optional(),
  expirationFrom: z.string().optional().describe('YYYY-MM-DD, earliest expiry'),
  expirationTo: z.string().optional().describe('YYYY-MM-DD, latest expiry'),
  strikeFrom: z.number().positive().optional(),
  strikeTo: z.number().positive().optional(),
  limit: z.number().int().positive().max(MAX_CONTRACTS).optional(),
}
const historyShape = {
  fund: z.string().optional().describe('omit to see every fund'),
  status: z.enum(['pending', 'open', 'closing', 'closed', 'cancelled']).optional(),
  limit: z.number().int().positive().max(MAX_HISTORY).optional(),
}

const adjustShape = {
  fund: z.string().describe('your fund id; only a lot held by this fund is adjusted'),
  symbol: z.string(),
  stop: z.number().positive().optional(),
  target: z.number().positive().optional(),
  trailPct: z
    .number()
    .positive()
    .max(MAX_TRAIL_PCT)
    .nullable()
    .optional()
    .describe('set a trailing stop percentage, or null to remove it'),
}

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean }

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] })
const failed = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

export const toolFailures: string[] = []
const MAX_FAILURES = 20

export async function attempt(action: () => Promise<string>): Promise<ToolResult> {
  try {
    return ok(await action())
  } catch (error) {
    const message =
      error instanceof SiteError
        ? `Rejected (${error.status}): ${error.body}`
        : `Tool error: ${errorMessage(error)}`
    if (toolFailures.length < MAX_FAILURES) {
      toolFailures.push(message)
    }
    return failed(message)
  }
}

function openPositionTool(
  site: SiteClient,
  opens: Map<string, number>,
): SdkMcpToolDefinition<typeof openShape> {
  return tool(
    'open_position',
    'Buy an asset: at market by dollar amount (notional), or queue a limit order (qty + limit) that fills when the price reaches your limit, even while you are off. Crypto symbols look like BTC/USD. Every fill is posted publicly using your reason, stop, target and horizon.',
    openShape,
    async (input) => {
      const used = opens.get(input.fund) ?? 0
      if (used >= MAX_OPENS_PER_FUND) {
        return failed(
          `Rejected: ${input.fund} already opened ${MAX_OPENS_PER_FUND} positions this run`,
        )
      }
      const result = await attempt(() => site.openPosition(input))
      if (result.isError !== true) {
        opens.set(input.fund, used + 1)
      }
      return result
    },
  )
}

function closePositionTool(site: SiteClient): SdkMcpToolDefinition<typeof closeShape> {
  return tool(
    'close_position',
    'Sell an open position at market, all of it or a fraction of it. The sale is posted publicly with your reason.',
    closeShape,
    ({ symbol, ...body }) => attempt(() => site.closePosition(symbol, body)),
  )
}

function cancelOrderTool(site: SiteClient): SdkMcpToolDefinition<typeof cancelShape> {
  return tool(
    'cancel_order',
    'Withdraw a queued limit order that has not filled yet.',
    cancelShape,
    ({ symbol, ...body }) => attempt(() => site.cancelOrder(symbol, body)),
  )
}

const contractQuery = (input: {
  underlying: string
  type?: 'call' | 'put' | undefined
  expirationFrom?: string | undefined
  expirationTo?: string | undefined
  strikeFrom?: number | undefined
  strikeTo?: number | undefined
  limit?: number | undefined
}): Record<string, string> => {
  const pairs: [string, string | number | undefined][] = [
    ['underlying_symbols', input.underlying.toUpperCase()],
    ['type', input.type],
    ['expiration_date_gte', input.expirationFrom],
    ['expiration_date_lte', input.expirationTo],
    ['strike_price_gte', input.strikeFrom],
    ['strike_price_lte', input.strikeTo],
    ['limit', input.limit ?? DEFAULT_CONTRACTS],
  ]
  return Object.fromEntries(
    pairs.filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]),
  )
}

function optionContractsTool(site: SiteClient): SdkMcpToolDefinition<typeof contractsShape> {
  return tool(
    'option_contracts',
    'List tradable option contracts for an underlying (OCC symbols like AAPL260116C00190000, strike, expiry, open interest, close price). Buy one with open_position using qty (whole contracts) and the contract symbol; the premium is qty x price x 100.',
    contractsShape,
    (input) => attempt(() => site.optionContracts(contractQuery(input))),
  )
}

function adjustExitsTool(site: SiteClient): SdkMcpToolDefinition<typeof adjustShape> {
  return tool(
    'adjust_exits',
    'Move the stop, target and/or trailing stop of an open position. Stop must stay below and target above the current price.',
    adjustShape,
    ({ symbol, ...body }) => attempt(() => site.adjustExits(symbol, body)),
  )
}

const asQuery = (input: Record<string, string | number | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(input)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  )

function queryTradesTool(site: SiteClient): SdkMcpToolDefinition<typeof historyShape> {
  return tool(
    'query_trades',
    'Read the trade history: every order with its fund, quantity, limit price, entry and exit prices, stop, target, reason, exit reason and timestamps. Use it to measure your own edge: win rate by setup, slippage by order type and session, how often stops or targets hit.',
    historyShape,
    (input) => attempt(() => site.trades(asQuery(input))),
  )
}

export type ToolList = NonNullable<Parameters<typeof createSdkMcpServer>[0]['tools']>

const readTools = (site: SiteClient): ToolList => [optionContractsTool(site), queryTradesTool(site)]

export function traderTools(site: SiteClient): ToolList {
  const opens = new Map<string, number>()
  return [
    openPositionTool(site, opens),
    closePositionTool(site),
    cancelOrderTool(site),
    adjustExitsTool(site),
    ...readTools(site),
  ]
}

export function traderServer(site: SiteClient): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: 'trader', tools: traderTools(site) })
}

const TRADE_TOOL_NAMES = [
  'mcp__trader__open_position',
  'mcp__trader__close_position',
  'mcp__trader__cancel_order',
  'mcp__trader__adjust_exits',
]
export function traderReadServer(site: SiteClient): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: 'trader', tools: readTools(site) })
}

export const READ_TOOL_NAMES = ['mcp__trader__option_contracts', 'mcp__trader__query_trades']
export const TOOL_NAMES = [...TRADE_TOOL_NAMES, ...READ_TOOL_NAMES]

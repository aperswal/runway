import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import type * as Sdk from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { SiteError } from './errors.ts'
import type { SiteClient } from './site.ts'
import {
  MAX_OPENS_PER_FUND,
  TOOL_NAMES,
  attempt,
  traderServer,
  toolFailures,
  READ_TOOL_NAMES,
  traderReadServer,
} from './tools.ts'

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  createSdkMcpServer: (options: { name: string; tools?: SdkMcpToolDefinition[] }) => ({
    type: 'sdk',
    name: options.name,
    instance: options.tools ?? [],
  }),
}))

const toolsOf = (server: McpSdkServerConfigWithInstance): SdkMcpToolDefinition[] =>
  server.instance as unknown as SdkMcpToolDefinition[]
const handlerOf = (server: McpSdkServerConfigWithInstance, name: string) =>
  toolsOf(server).find((t) => t.name === name)!.handler
const contractOf = (server: McpSdkServerConfigWithInstance, name: string) => {
  const found = toolsOf(server).find((t) => t.name === name)!
  const { properties, required } = z.toJSONSchema(z.object(found.inputSchema))
  return { description: found.description, properties, required }
}

const fakeSite = () => ({
  openPosition: vi.fn<(body: unknown) => Promise<string>>().mockResolvedValue('filled'),
  trades: vi.fn<(query: Record<string, string>) => Promise<string>>().mockResolvedValue('history'),
  closePosition: vi
    .fn<(symbol: string, body: unknown) => Promise<string>>()
    .mockResolvedValue('sold'),
  adjustExits: vi
    .fn<(symbol: string, body: unknown) => Promise<string>>()
    .mockResolvedValue('moved'),
  cancelOrder: vi
    .fn<(symbol: string, body: unknown) => Promise<string>>()
    .mockResolvedValue('cancelled'),
  optionContracts: vi
    .fn<(query: Record<string, string>) => Promise<string>>()
    .mockResolvedValue('{"option_contracts":[]}'),
})
const serverFor = (site: ReturnType<typeof fakeSite>) => traderServer(site as unknown as SiteClient)

const open = {
  fund: 'alpha',
  symbol: 'AAPL',
  notional: 100,
  stop: 90,
  target: 120,
  horizon: '3 weeks',
  reason: 'because',
}

describe('attempt', () => {
  it('wraps the result as text content', async () =>
    expect(await attempt(() => Promise.resolve('ok'))).toEqual({
      content: [{ type: 'text', text: 'ok' }],
    }))
  it('turns a SiteError into an error result', async () =>
    expect(await attempt(() => Promise.reject(new SiteError(400, 'market closed')))).toEqual({
      content: [{ type: 'text', text: 'Rejected (400): market closed' }],
      isError: true,
    }))
  it('reports other errors to the model and records them', async () => {
    toolFailures.length = 0
    await expect(attempt(() => Promise.reject(new Error('boom')))).resolves.toEqual({
      content: [{ type: 'text', text: 'Tool error: boom' }],
      isError: true,
    })
    expect(toolFailures).toEqual(['Tool error: boom'])
    toolFailures.length = 0
  })
  it('stops recording after twenty failures but keeps answering', async () => {
    toolFailures.length = 0
    for (let i = 0; i < 25; i += 1) {
      await attempt(() => Promise.reject(new Error(`e${i}`)))
    }
    expect(toolFailures).toHaveLength(20)
    expect(toolFailures[19]).toBe('Tool error: e19')
    toolFailures.length = 0
  })
})

describe('traderServer', () => {
  it('registers the trader tools under the exported names', () => {
    const server = serverFor(fakeSite())
    expect(server.name).toBe('trader')
    expect(toolsOf(server).map((t) => `mcp__trader__${t.name}`)).toEqual(TOOL_NAMES)
  })
  it('offers only the read-only tools on the research side', () => {
    const readOnly = traderReadServer(fakeSite() as unknown as SiteClient)
    expect(readOnly.name).toBe('trader')
    expect(toolsOf(readOnly).map((t) => `mcp__trader__${t.name}`)).toEqual(READ_TOOL_NAMES)
  })
  it('describes open_position for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'open_position')).toEqual({
      description:
        'Buy an asset: at market by dollar amount (notional), or queue a limit order (qty + limit) that fills when the price reaches your limit, even while you are off. Crypto symbols look like BTC/USD. Every fill is posted publicly using your reason, stop, target and horizon.',
      properties: {
        fund: { type: 'string', description: 'your fund id' },
        symbol: { type: 'string', description: 'AAPL or BTC/USD' },
        notional: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'dollars to spend with a market order (give notional or qty, not both)',
        },
        qty: {
          type: 'number',
          exclusiveMinimum: 0,
          description: 'shares or coins to buy; required for limit orders',
        },
        limit: {
          type: 'number',
          exclusiveMinimum: 0,
          description:
            'queue a limit order at this price instead of buying at market; whole-share limit orders also work in pre-market, after-hours and overnight sessions',
        },
        aliveHours: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 168,
          description:
            'how long a queued limit order stays alive (default 24, max 168); it is re-placed each session until then',
        },
        stop: { type: 'number', exclusiveMinimum: 0, description: 'sell if price drops to this' },
        target: { type: 'number', exclusiveMinimum: 0, description: 'sell if price rises to this' },
        trailPct: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 50,
          description:
            'trailing stop: every 15 minutes the venue raises the stop to this percentage below the latest price, never lowers it',
        },
        horizon: {
          type: 'string',
          maxLength: 40,
          description: 'expected time to profitability, e.g. "3 weeks"',
        },
        reason: { type: 'string', maxLength: 150, description: 'one sentence, published verbatim' },
      },
      required: ['fund', 'symbol', 'stop', 'target', 'horizon', 'reason'],
    }))
  it('describes close_position for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'close_position')).toEqual({
      description:
        'Sell an open position at market, all of it or a fraction of it. The sale is posted publicly with your reason.',
      properties: {
        fund: { type: 'string', description: 'your fund id; only a lot held by this fund is sold' },
        symbol: { type: 'string' },
        reason: { type: 'string', maxLength: 150, description: 'one sentence, published verbatim' },
        fraction: {
          type: 'number',
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
          description: 'sell only this fraction of the lot (take partial profit); omit to sell all',
        },
      },
      required: ['fund', 'symbol', 'reason'],
    }))
  it('describes cancel_order for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'cancel_order')).toEqual({
      description: 'Withdraw a queued limit order that has not filled yet.',
      properties: {
        fund: {
          type: 'string',
          description: 'your fund id; only an order queued by this fund is withdrawn',
        },
        symbol: { type: 'string' },
        reason: {
          type: 'string',
          maxLength: 150,
          description: 'why the queued order is withdrawn',
        },
      },
      required: ['fund', 'symbol', 'reason'],
    }))
  it('cancel_order forwards symbol and reason', async () => {
    const site = fakeSite()
    await expect(
      handlerOf(serverFor(site), 'cancel_order')(
        { fund: 'alpha', symbol: 'AAPL', reason: 'stale' },
        {},
      ),
    ).resolves.toEqual({ content: [{ type: 'text', text: 'cancelled' }] })
    expect(site.cancelOrder).toHaveBeenCalledWith('AAPL', { fund: 'alpha', reason: 'stale' })
  })
  it('describes option_contracts and maps its query to Alpaca parameters', async () => {
    const site = fakeSite()
    const server = serverFor(site)
    expect(contractOf(server, 'option_contracts')).toMatchObject({
      description:
        'List tradable option contracts for an underlying (OCC symbols like AAPL260116C00190000, strike, expiry, open interest, close price). Buy one with open_position using qty (whole contracts) and the contract symbol; the premium is qty x price x 100.',
      properties: {
        underlying: { type: 'string', description: 'underlying stock symbol, e.g. AAPL' },
        type: { type: 'string', enum: ['call', 'put'] },
        expirationFrom: { type: 'string', description: 'YYYY-MM-DD, earliest expiry' },
        expirationTo: { type: 'string', description: 'YYYY-MM-DD, latest expiry' },
        limit: { type: 'integer', exclusiveMinimum: 0, maximum: 500 },
      },
      required: ['underlying'],
    })
    await expect(
      handlerOf(server, 'option_contracts')(
        {
          underlying: 'aapl',
          type: 'call',
          expirationFrom: '2026-01-01',
          expirationTo: '2026-03-01',
          strikeFrom: 150,
          strikeTo: 220,
          limit: 20,
        },
        {},
      ),
    ).resolves.toEqual({ content: [{ type: 'text', text: '{"option_contracts":[]}' }] })
    expect(site.optionContracts).toHaveBeenCalledWith({
      underlying_symbols: 'AAPL',
      type: 'call',
      expiration_date_gte: '2026-01-01',
      expiration_date_lte: '2026-03-01',
      strike_price_gte: '150',
      strike_price_lte: '220',
      limit: '20',
    })
    await handlerOf(server, 'option_contracts')({ underlying: 'NVDA' }, {})
    expect(site.optionContracts).toHaveBeenLastCalledWith({
      underlying_symbols: 'NVDA',
      limit: '100',
    })
  })
  it('describes query_trades and forwards its filters as a query string', async () => {
    const contract = contractOf(serverFor(fakeSite()), 'query_trades')
    expect(contract.required).toBeUndefined()
    expect(contract.properties).toMatchObject({
      status: { type: 'string', enum: ['pending', 'open', 'closing', 'closed', 'cancelled'] },
      limit: { type: 'integer', exclusiveMinimum: 0, maximum: 500 },
    })
    const site = fakeSite()
    await expect(
      handlerOf(serverFor(site), 'query_trades')(
        { fund: 'alpha', status: 'closed', limit: 20 },
        {},
      ),
    ).resolves.toEqual({ content: [{ type: 'text', text: 'history' }] })
    expect(site.trades).toHaveBeenCalledWith({ fund: 'alpha', status: 'closed', limit: '20' })
    await handlerOf(serverFor(site), 'query_trades')({}, {})
    expect(site.trades).toHaveBeenLastCalledWith({})
  })
  it('describes adjust_exits for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'adjust_exits')).toEqual({
      description:
        'Move the stop, target and/or trailing stop of an open position. Stop must stay below and target above the current price.',
      properties: {
        fund: {
          type: 'string',
          description: 'your fund id; only a lot held by this fund is adjusted',
        },
        symbol: { type: 'string' },
        stop: { type: 'number', exclusiveMinimum: 0 },
        target: { type: 'number', exclusiveMinimum: 0 },
        trailPct: {
          anyOf: [{ type: 'number', exclusiveMinimum: 0, maximum: 50 }, { type: 'null' }],
          description: 'set a trailing stop percentage, or null to remove it',
        },
      },
      required: ['fund', 'symbol'],
    }))
  it('open_position forwards the input and counts opens per fund', async () => {
    const site = fakeSite()
    const handler = handlerOf(serverFor(site), 'open_position')
    for (let i = 0; i < MAX_OPENS_PER_FUND; i += 1) {
      await expect(handler(open, {})).resolves.toEqual({
        content: [{ type: 'text', text: 'filled' }],
      })
    }
    await expect(handler(open, {})).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: `Rejected: alpha already opened ${MAX_OPENS_PER_FUND} positions this run`,
        },
      ],
      isError: true,
    })
    expect(site.openPosition).toHaveBeenCalledTimes(MAX_OPENS_PER_FUND)
    expect(site.openPosition).toHaveBeenCalledWith(open)
    await expect(handler({ ...open, fund: 'beta' }, {})).resolves.toEqual({
      content: [{ type: 'text', text: 'filled' }],
    })
  })
  it('open_position does not count a rejected open', async () => {
    const site = fakeSite()
    site.openPosition.mockRejectedValueOnce(new SiteError(422, 'over cap'))
    const handler = handlerOf(serverFor(site), 'open_position')
    await expect(handler(open, {})).resolves.toEqual({
      content: [{ type: 'text', text: 'Rejected (422): over cap' }],
      isError: true,
    })
    for (let i = 0; i < MAX_OPENS_PER_FUND; i += 1) {
      await expect(handler(open, {})).resolves.toEqual({
        content: [{ type: 'text', text: 'filled' }],
      })
    }
    expect(site.openPosition).toHaveBeenCalledTimes(MAX_OPENS_PER_FUND + 1)
  })
  it('close_position forwards the fund, symbol, reason and fraction', async () => {
    const site = fakeSite()
    await expect(
      handlerOf(serverFor(site), 'close_position')(
        { fund: 'alpha', symbol: 'AAPL', reason: 'done' },
        {},
      ),
    ).resolves.toEqual({ content: [{ type: 'text', text: 'sold' }] })
    expect(site.closePosition).toHaveBeenCalledWith('AAPL', { fund: 'alpha', reason: 'done' })
    await handlerOf(serverFor(site), 'close_position')(
      { fund: 'alpha', symbol: 'AAPL', reason: 'quarter', fraction: 0.25 },
      {},
    )
    expect(site.closePosition).toHaveBeenLastCalledWith('AAPL', {
      fund: 'alpha',
      reason: 'quarter',
      fraction: 0.25,
    })
  })
  it('adjust_exits forwards the fund with the new stop, target and trail', async () => {
    const site = fakeSite()
    await expect(
      handlerOf(serverFor(site), 'adjust_exits')({ fund: 'alpha', symbol: 'AAPL', stop: 95 }, {}),
    ).resolves.toEqual({ content: [{ type: 'text', text: 'moved' }] })
    expect(site.adjustExits).toHaveBeenCalledWith('AAPL', { fund: 'alpha', stop: 95 })
    await handlerOf(serverFor(site), 'adjust_exits')(
      { fund: 'alpha', symbol: 'AAPL', trailPct: 8 },
      {},
    )
    expect(site.adjustExits).toHaveBeenLastCalledWith('AAPL', { fund: 'alpha', trailPct: 8 })
  })
})

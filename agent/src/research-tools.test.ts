import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import type * as Sdk from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ANALYSIS_KINDS, RESEARCH_TOOL_NAMES, researchServer } from './research-tools.ts'
import type { SiteClient } from './site.ts'

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
  recordAnalysis: vi.fn<(body: unknown) => Promise<string>>().mockResolvedValue('saved'),
  recordObservation: vi.fn<(body: unknown) => Promise<string>>().mockResolvedValue('noted'),
  recordNote: vi.fn<(body: unknown) => Promise<string>>().mockResolvedValue('journaled'),
  recordLesson: vi.fn<(body: unknown) => Promise<string>>().mockResolvedValue('saved'),
  research: vi
    .fn<(kind: string, query: Record<string, string>) => Promise<string>>()
    .mockResolvedValue('[]'),
})
const serverFor = (site: ReturnType<typeof fakeSite>) =>
  researchServer(site as unknown as SiteClient)

describe('researchServer', () => {
  it('registers the research tools under the exported names', () => {
    const server = serverFor(fakeSite())
    expect(server.name).toBe('research')
    expect(toolsOf(server).map((t) => `mcp__research__${t.name}`)).toEqual(RESEARCH_TOOL_NAMES)
  })
  it('describes record_analysis for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'record_analysis')).toEqual({
      description:
        'Save an analysis (statistical, technical, fundamental, simulation, consequences, backtest, indicators, strategy) with its key figures. Analyses are shown on the public Stats page and read back by future runs.',
      properties: {
        fund: { type: 'string' },
        kind: {
          type: 'string',
          enum: [...ANALYSIS_KINDS],
          description:
            'statistical (distributions, correlations, regressions), technical (indicators, levels, regimes), fundamental (filings, unit economics, valuation), simulation (Monte Carlo, scenario paths), consequences (1st, 2nd and 3rd order effects of an event), backtest (a strategy run on history), indicators (how indicators combine), strategy (a rule set you built)',
        },
        symbols: {
          anyOf: [{ type: 'array', items: { type: 'string' }, maxItems: 20 }, { type: 'null' }],
          description: 'tickers it covers, or null',
        },
        title: { type: 'string', maxLength: 120 },
        body: {
          type: 'string',
          maxLength: 4000,
          description:
            'method, findings and what you will do about it; for consequences list 1st, 2nd and 3rd order',
        },
        figures: {
          type: 'object',
          propertyNames: { type: 'string', maxLength: 40 },
          additionalProperties: {
            anyOf: [{ type: 'number' }, { type: 'string', maxLength: 40 }],
          },
          description:
            'up to 12 key numbers, e.g. {"return": 12.4, "drawdown": 8.1, "win rate": 61, "sample": 240}; use "return" and "drawdown" in percent so backtests rank on the Stats page',
        },
        verdict: {
          anyOf: [
            { type: 'string', enum: ['adopt', 'reject', 'inconclusive', 'watch'] },
            { type: 'null' },
          ],
        },
      },
      required: ['fund', 'kind', 'symbols', 'title', 'body', 'figures', 'verdict'],
    }))
  it('describes record_observation for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'record_observation')).toEqual({
      description:
        'Save a datapoint you measured (a signal, a metric, a fact with its source) to your research memory.',
      properties: {
        fund: { type: 'string' },
        symbol: {
          anyOf: [{ type: 'string', maxLength: 120 }, { type: 'null' }],
          description: 'ticker or BTC/USD, or null for market-wide',
        },
        source: { type: 'string', maxLength: 2000, description: 'URL or feed name' },
        metric: {
          type: 'string',
          maxLength: 120,
          description: 'what was measured, e.g. "amazon review velocity 7d"',
        },
        value: { type: ['number', 'null'] },
        note: { type: 'string', maxLength: 2000 },
      },
      required: ['fund', 'symbol', 'source', 'metric', 'value', 'note'],
    }))
  it('describes record_note for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'record_note')).toEqual({
      description:
        'Write a note to your fund journal. Notes are private to the fund and shown back to you next run.',
      properties: {
        fund: { type: 'string' },
        title: { type: 'string', maxLength: 120 },
        body: {
          type: 'string',
          maxLength: 2000,
          description: 'free-form: a thesis forming, a watchlist, what to check next run',
        },
      },
      required: ['fund', 'title', 'body'],
    }))
  it('describes query_research for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'query_research')).toEqual({
      description:
        "Read back saved analyses, observations, notes or lessons, optionally filtered by symbol. Analyses and observations from every fund are the shared stats corpus; notes and lessons are your fund's own.",
      properties: {
        kind: { type: 'string', enum: ['analyses', 'observations', 'notes', 'lessons'] },
        fund: {
          type: 'string',
          description:
            'analyses and observations are shared: omit fund to read every fund; notes and lessons are private and need your fund',
        },
        analysisKind: {
          type: 'string',
          enum: [
            'statistical',
            'technical',
            'fundamental',
            'simulation',
            'consequences',
            'backtest',
            'indicators',
            'strategy',
          ],
          description: 'filter analyses by kind',
        },
        symbol: { type: 'string' },
        limit: { type: 'integer', exclusiveMinimum: 0, maximum: 500 },
      },
      required: ['kind'],
    }))
  it('record_analysis caps figures at 12', () => {
    const found = toolsOf(serverFor(fakeSite())).find((t) => t.name === 'record_analysis')!
    const figures = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, i]))
    const base = {
      fund: 'a',
      kind: 'backtest',
      symbols: null,
      title: 't',
      body: 'b',
      verdict: null,
    }
    const tooMany = z.object(found.inputSchema).safeParse({ ...base, figures })
    expect(tooMany.error?.issues[0]?.message).toBe('at most 12 figures')
    const twelve = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, i]))
    expect(z.object(found.inputSchema).safeParse({ ...base, figures: twelve }).success).toBe(true)
    expect(z.object(found.inputSchema).safeParse({ ...base, figures: { return: 1 } }).success).toBe(
      true,
    )
  })
  it('query_research reads shared kinds across funds, filters analyses by kind, and keeps notes private', async () => {
    const site = fakeSite()
    const handler = handlerOf(serverFor(site), 'query_research')
    await handler({ kind: 'analyses', analysisKind: 'backtest', symbol: 'AAPL' }, {})
    expect(site.research).toHaveBeenLastCalledWith('analyses', { kind: 'backtest', symbol: 'AAPL' })
    await handler({ kind: 'observations', analysisKind: 'backtest', limit: 5 }, {})
    expect(site.research).toHaveBeenLastCalledWith('observations', { limit: '5' })
    const refused = await handler({ kind: 'lessons' }, {})
    expect(refused.isError).toBe(true)
    expect(refused.content).toEqual([
      { type: 'text', text: 'Tool error: lessons are private to a fund; pass fund' },
    ])
  })
  it('describes record_lesson for the model and posts it with a null trade id by default', async () => {
    const contract = contractOf(serverFor(fakeSite()), 'record_lesson')
    expect(contract.required).toEqual(['fund', 'kind', 'lesson'])
    expect(contract.properties).toMatchObject({
      kind: { type: 'string', enum: ['technical', 'execution', 'psyche'] },
      lesson: { type: 'string', maxLength: 2000 },
      tradeId: { type: 'integer', exclusiveMinimum: 0 },
    })
    const site = fakeSite()
    const handler = handlerOf(serverFor(site), 'record_lesson')
    await expect(
      handler({ fund: 'alpha', kind: 'psyche', lesson: 'do not chase' }, {}),
    ).resolves.toEqual({ content: [{ type: 'text', text: 'saved' }] })
    expect(site.recordLesson).toHaveBeenCalledWith({
      fund: 'alpha',
      kind: 'psyche',
      lesson: 'do not chase',
      tradeId: null,
    })
    await handler({ fund: 'alpha', kind: 'execution', lesson: 'limit orders', tradeId: 7 }, {})
    expect(site.recordLesson).toHaveBeenLastCalledWith({
      fund: 'alpha',
      kind: 'execution',
      lesson: 'limit orders',
      tradeId: 7,
    })
  })
  it('record_analysis posts the analysis', async () => {
    const site = fakeSite()
    const input = {
      fund: 'alpha',
      kind: 'backtest',
      symbols: ['AAPL'],
      title: 'sma 10/50',
      body: 'b',
      figures: { return: 12.4 },
      verdict: 'adopt',
    }
    await expect(handlerOf(serverFor(site), 'record_analysis')(input, {})).resolves.toEqual({
      content: [{ type: 'text', text: 'saved' }],
    })
    expect(site.recordAnalysis).toHaveBeenCalledWith(input)
  })
  it('record_observation posts the observation', async () => {
    const site = fakeSite()
    const input = {
      fund: 'alpha',
      symbol: null,
      source: 'https://x.test',
      metric: 'review velocity',
      value: 1.5,
      note: 'n',
    }
    await expect(handlerOf(serverFor(site), 'record_observation')(input, {})).resolves.toEqual({
      content: [{ type: 'text', text: 'noted' }],
    })
    expect(site.recordObservation).toHaveBeenCalledWith(input)
  })
  it('record_note posts the note', async () => {
    const site = fakeSite()
    const input = { fund: 'alpha', title: 'watchlist', body: 'check NVDA next run' }
    await expect(handlerOf(serverFor(site), 'record_note')(input, {})).resolves.toEqual({
      content: [{ type: 'text', text: 'journaled' }],
    })
    expect(site.recordNote).toHaveBeenCalledWith(input)
  })
  it('query_research drops undefined filters and stringifies the rest', async () => {
    const site = fakeSite()
    const handler = handlerOf(serverFor(site), 'query_research')
    await expect(handler({ kind: 'analyses', fund: 'alpha', limit: 5 }, {})).resolves.toEqual({
      content: [{ type: 'text', text: '[]' }],
    })
    expect(site.research).toHaveBeenCalledWith('analyses', { fund: 'alpha', limit: '5' })
    await handler({ kind: 'observations', fund: 'beta', symbol: 'AAPL' }, {})
    expect(site.research).toHaveBeenCalledWith('observations', { fund: 'beta', symbol: 'AAPL' })
    await handler({ kind: 'notes', fund: 'alpha' }, {})
    expect(site.research).toHaveBeenCalledWith('notes', { fund: 'alpha' })
  })
})

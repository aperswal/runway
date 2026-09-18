import type { ModelUsage, SDKResultMessage, SDKResultSuccess } from '@anthropic-ai/claude-agent-sdk'
import type * as Sdk from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from './env.ts'
import {
  cioOptions,
  managerOptions,
  runAgent,
  runQuery,
  toolResultErrors,
  runManager,
  runOneManager,
} from './run.ts'
import { toReport, withToolFailures } from './report.ts'
import { toolFailures } from './tools.ts'
import { SiteClient, type FundRecord } from './site.ts'

const mocks = vi.hoisted(() => ({ query: vi.fn(), runCodex: vi.fn() }))
vi.mock('./codex.ts', () => ({ CODEX_MINUTES: 45, runCodex: mocks.runCodex }))
vi.mock('./sleep.ts', () => ({ sleep: () => Promise.resolve() }))
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  query: mocks.query,
}))

afterEach(() => {
  vi.unstubAllGlobals()
  mocks.query.mockReset()
})

const base = {
  SITE_URL: 'https://runway.test',
  INTERNAL_TOKEN: 'internal-token-long-enough',
  DATA_TOKEN: 'data-token-long-enough-too',
  PATH: '/usr/bin',
  HOME: '/home/runway',
}
const config = loadConfig(base)
const site = new SiteClient(base.SITE_URL, base.INTERNAL_TOKEN)
const funds: FundRecord[] = [
  { id: 'alpha', name: 'Alpha', mandate: 'Alpha mandate', share: 0.4, status: 'active' },
  { id: 'omega', name: 'Omega', mandate: 'Omega mandate', share: 0.2, status: 'retired' },
]

const usage = (inputTokens: number, outputTokens: number, cached: number): ModelUsage =>
  ({
    inputTokens,
    outputTokens,
    cacheReadInputTokens: cached,
    cacheCreationInputTokens: cached,
  }) as ModelUsage
const success = (over: Partial<SDKResultSuccess> = {}): SDKResultMessage =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 4,
    result: 'summary text',
    total_cost_usd: 0.25,
    modelUsage: { 'claude-a': usage(10, 5, 1), 'claude-b': usage(20, 7, 2) },
    ...over,
  }) as SDKResultMessage
const failure = (): SDKResultMessage =>
  ({
    type: 'result',
    subtype: 'error_max_turns',
    num_turns: 9,
    total_cost_usd: 1,
    modelUsage: {},
    errors: ['too long', 'gave up'],
  }) as SDKResultMessage

const research = [
  'mcp__research__record_analysis',
  'mcp__research__record_observation',
  'mcp__research__record_note',
  'mcp__research__record_lesson',
  'mcp__research__query_research',
]
const jobs = ['mcp__jobs__schedule_job', 'mcp__jobs__list_jobs', 'mcp__jobs__cancel_job']
const monitors = [
  'mcp__monitors__set_monitor',
  'mcp__monitors__list_monitors',
  'mcp__monitors__resolve_monitor',
]
const trader = [
  'mcp__trader__open_position',
  'mcp__trader__close_position',
  'mcp__trader__cancel_order',
  'mcp__trader__adjust_exits',
  'mcp__trader__option_contracts',
  'mcp__trader__query_trades',
]
const cio = ['mcp__cio__create_fund', 'mcp__cio__reallocate_fund', 'mcp__cio__retire_fund']

describe('managerOptions and cioOptions', () => {
  const alpha = funds[0]!
  it('gives a manager its mandate, research built-ins and the trader and research tools', () => {
    const options = managerOptions(config, site, alpha)
    expect(options.systemPrompt).toContain('Alpha mandate')
    expect(options.systemPrompt).toContain('Your budget for this run is 120 turns')
    expect(options.tools).toEqual(['WebSearch', 'WebFetch', 'Bash'])
    expect(options.model).toBe('claude-sonnet-5')
    expect(options.allowedTools).toEqual([
      'WebSearch',
      'WebFetch',
      'Bash',
      ...trader,
      ...research,
      ...jobs,
      ...monitors,
    ])
    expect(Object.keys(options.mcpServers ?? {})).toEqual([
      'trader',
      'research',
      'jobs',
      'monitors',
    ])
    expect(options).toMatchObject({ maxTurns: 120, permissionMode: 'dontAsk' })
    expect(options.cwd).toBeTypeOf('string')
  })
  it('gives the CIO the fund list, no Bash, the fund and research tools, and no order tools', () => {
    const options = cioOptions(config, site, funds)
    expect(options.systemPrompt).toContain('alpha (Alpha, 40% cap)')
    expect(options.systemPrompt).toContain('Reserve the last 12 turns for the fund changes')
    expect(options.tools).toEqual(['WebSearch', 'WebFetch'])
    expect(options.allowedTools).toEqual([
      'WebSearch',
      'WebFetch',
      ...cio,
      'mcp__trader__option_contracts',
      'mcp__trader__query_trades',
      ...research,
    ])
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['cio', 'trader', 'research'])
    expect(options).not.toHaveProperty('model')
  })
  it('merges external MCP servers first and allows their tools for both', () => {
    const external = { papers: { type: 'http' as const, url: 'https://x.test/mcp' } }
    const manager = managerOptions(config, site, alpha, external)
    const chief = cioOptions(config, site, funds, external)
    expect(Object.keys(manager.mcpServers ?? {})).toEqual([
      'papers',
      'trader',
      'research',
      'jobs',
      'monitors',
    ])
    expect(Object.keys(chief.mcpServers ?? {})).toEqual(['papers', 'cio', 'trader', 'research'])
    expect(manager.mcpServers?.papers).toEqual(external.papers)
    expect(manager.allowedTools?.at(-1)).toBe('mcp__papers')
    expect(chief.allowedTools?.at(-1)).toBe('mcp__papers')
  })
  it('routes managers to Codex when the dispatch carries its auth, with the scoped manager token', async () => {
    mocks.runCodex.mockResolvedValue({ result: undefined, error: 'x', seen: [] })
    const codexConfig = loadConfig({ ...base, RESEARCH_TOKEN: 'research-token' })
    await runManager('ctx', alpha, { config: codexConfig, site, external: {} }, '{"tokens":{}}')
    expect(mocks.runCodex).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'ctx',
        instructions: expect.stringMatching(/You run the Alpha fund[^]*45 minutes \(wall clock/),
        auth: '{"tokens":{}}',
        tokens: { research: 'research-token' },
      }),
      expect.objectContaining({ SITE_URL: base.SITE_URL, DATA_TOKEN: base.DATA_TOKEN }),
    )
    expect(mocks.runCodex.mock.calls[0]?.[1]).not.toHaveProperty('INTERNAL_TOKEN')
    await runManager('ctx', alpha, { config, site, external: {} }, '{}')
    expect(mocks.runCodex.mock.calls[1]?.[0]).toMatchObject({
      tokens: { research: base.INTERNAL_TOKEN },
    })
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('omits the model and oauth token when unset', () => {
    const options = cioOptions(config, site, funds)
    expect(options).not.toHaveProperty('model')
    expect(options.env).toStrictEqual({
      PATH: base.PATH,
      HOME: base.HOME,
      SITE_URL: base.SITE_URL,
      DATA_TOKEN: base.DATA_TOKEN,
    })
  })
  it('passes the model and oauth token when set', () => {
    const options = cioOptions(
      loadConfig({ ...base, AGENT_MODEL: 'claude-x', CLAUDE_CODE_OAUTH_TOKEN: 'oauth' }),
      site,
      funds,
    )
    expect(options.model).toBe('claude-x')
    expect(options.env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth' })
    const manager = managerOptions(
      loadConfig({ ...base, AGENT_MODEL: 'claude-x', MANAGER_MODEL: 'claude-small' }),
      site,
      alpha,
    )
    expect(manager.model).toBe('claude-small')
  })
})

const reports = new Map<string, unknown>()

const siteHandler =
  (list: FundRecord[]) =>
  async (url: string, init?: RequestInit): Promise<Response> => {
    if (url.includes('/internal/context?trigger=')) {
      return new Response('account state')
    }
    if (url.endsWith('/internal/funds')) {
      return new Response(JSON.stringify(list))
    }
    const manager = /\/internal\/managers\/([^/]+)\/run$/.exec(url)
    if (manager !== null) {
      const { trigger } = JSON.parse(init?.body as string) as { trigger: string }
      const fund = decodeURIComponent(manager[1]!)
      reports.set(fund, await runOneManager(fund, trigger, config))
      return new Response(JSON.stringify({ key: fund }), { status: 202 })
    }
    const report = /\/internal\/managers\/[^/]+\/report\?key=(.+)$/.exec(url)
    if (report !== null) {
      return new Response(JSON.stringify({ done: true, outcome: reports.get(report[1]!) }))
    }
    return new Response('recorded')
  }

function stubSite() {
  const fetchMock = vi.fn(siteHandler(funds))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const recordedRun = (fetchMock: ReturnType<typeof stubSite>): unknown => {
  const body = fetchMock.mock.calls.find(([url]) => url.endsWith('/internal/runs'))?.[1]?.body
  return typeof body === 'string' ? JSON.parse(body) : null
}

describe('runQuery', () => {
  it('collects the result and the tool errors the model saw', async () => {
    mocks.query.mockReturnValue([
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', is_error: true, content: 'nope' }] },
      },
      success(),
    ])
    await expect(runQuery('p', { maxTurns: 1 })).resolves.toEqual({
      result: success(),
      error: null,
      seen: ['model saw: nope'],
    })
    expect(mocks.query).toHaveBeenCalledWith({ prompt: 'p', options: { maxTurns: 1 } })
  })
  it('captures a thrown error', async () => {
    mocks.query.mockImplementation(() => {
      throw new Error('sdk exploded')
    })
    await expect(runQuery('p', {})).resolves.toEqual({
      result: undefined,
      error: 'sdk exploded',
      seen: [],
    })
  })
})

describe('runOneManager', () => {
  it('reports an unknown or retired fund instead of running', async () => {
    stubSite()
    await expect(runOneManager('ghost', 'cron', config)).resolves.toEqual({
      result: undefined,
      error: 'no active fund ghost',
      seen: [],
    })
    expect(mocks.query).not.toHaveBeenCalled()
  })
})

describe('runAgent', () => {
  it('runs one query per active fund, then the CIO with their reports, and records the run', async () => {
    const fetchMock = stubSite()
    mocks.query
      .mockReturnValueOnce([{ type: 'assistant' }, success({ result: 'alpha did things' })])
      .mockReturnValueOnce([success({ result: 'cio letter', num_turns: 1, total_cost_usd: 0.5 })])
    const report = await runAgent('cron', config)
    expect(report).toMatchObject({
      trigger: 'cron',
      summary: 'cio letter',
      error: null,
      turns: 5,
      costUsd: 0.75,
      model: 'claude-a,claude-b',
      inputTokens: 72,
      outputTokens: 24,
    })
    expect(mocks.query).toHaveBeenCalledTimes(2)
    expect(mocks.query.mock.calls[0]?.[0]).toMatchObject({
      prompt: 'account state',
      options: expect.objectContaining({ systemPrompt: expect.stringContaining('Alpha mandate') }),
    })
    expect(mocks.query.mock.calls[1]?.[0]).toMatchObject({
      prompt: 'account state\n\n# Manager reports\n\n## alpha\nalpha did things',
      options: expect.objectContaining({
        systemPrompt: expect.stringContaining('chief investment officer'),
      }),
    })
    expect(recordedRun(fetchMock)).toEqual(report)
  })
  it('separates several manager reports with a blank line', async () => {
    const fetchMock = stubSite()
    fetchMock.mockImplementation(
      siteHandler([funds[0]!, { ...funds[0]!, id: 'beta', name: 'Beta' }]),
    )
    mocks.query
      .mockReturnValueOnce([success({ result: 'alpha did things' })])
      .mockReturnValueOnce([success({ result: 'beta did things' })])
      .mockReturnValueOnce([success({ result: 'cio letter' })])
    await runAgent('cron', config)
    expect(mocks.query.mock.calls[2]?.[0]).toMatchObject({
      prompt:
        'account state\n\n# Manager reports\n\n## alpha\nalpha did things\n\n## beta\nbeta did things',
    })
  })
  it('passes a failed manager on as a missing report and surfaces its error', async () => {
    stubSite()
    mocks.query
      .mockReturnValueOnce([success({ is_error: true, result: 'api down' })])
      .mockReturnValueOnce([success({ result: 'cio letter' })])
    const report = await runAgent('cron', config)
    expect(report).toMatchObject({ summary: 'cio letter', error: 'api down' })
    expect(mocks.query.mock.calls[1]?.[0]).toMatchObject({
      prompt: expect.stringContaining('## alpha\n(no report: api down)'),
    })
  })
  it('keeps the cycle alive when the site refuses to start a manager', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handler = siteHandler(funds)
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        url.endsWith('/run')
          ? Promise.resolve(new Response('boom', { status: 500 }))
          : handler(url, init),
      ),
    )
    mocks.query.mockReturnValueOnce([success({ result: 'cio letter' })])
    const report = await runAgent('cron', config)
    expect(report).toMatchObject({ summary: 'cio letter', error: 'manager alpha: site 500: boom' })
    expect(mocks.query.mock.calls[0]?.[0]).toMatchObject({
      prompt: expect.stringContaining('## alpha\n(no report: manager alpha: site 500: boom)'),
    })
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"manager dispatch failed","fund":"alpha"'),
    )
    errorSpy.mockRestore()
  })
  it('describes a thrown manager error and a max-turns manager in the CIO prompt', async () => {
    stubSite()
    mocks.query
      .mockImplementationOnce(() => {
        throw new Error('sdk exploded')
      })
      .mockReturnValueOnce([success({ result: 'cio letter' })])
    await expect(runAgent('cron', config)).resolves.toMatchObject({ error: 'sdk exploded' })
    expect(mocks.query.mock.calls[1]?.[0]).toMatchObject({
      prompt: expect.stringContaining('(no report: sdk exploded)'),
    })
    mocks.query.mockReset()
    stubSite()
    mocks.query.mockReturnValueOnce([failure()]).mockReturnValueOnce([success()])
    await expect(runAgent('cron', config)).resolves.toMatchObject({
      error: 'error_max_turns: too long; gave up',
    })
    expect(mocks.query.mock.calls[1]?.[0]).toMatchObject({
      prompt: expect.stringContaining('(no report: error_max_turns: too long; gave up)'),
    })
    mocks.query.mockReset()
    stubSite()
    mocks.query.mockReturnValueOnce([{ type: 'assistant' }]).mockReturnValueOnce([success()])
    expect(mocks.query.mock.calls).toHaveLength(0)
    await expect(runAgent('cron', config)).resolves.toMatchObject({ error: null })
    expect(mocks.query.mock.calls[1]?.[0]).toMatchObject({
      prompt: expect.stringContaining('(no report: no result message)'),
    })
  })
  it('records the errors the model saw across managers and the CIO', async () => {
    stubSite()
    mocks.query
      .mockReturnValueOnce([
        {
          type: 'user',
          message: { content: [{ type: 'tool_result', is_error: true, content: 'nope' }] },
        },
        success(),
      ])
      .mockReturnValueOnce([{ type: 'assistant' }])
    await expect(runAgent('manual', config)).resolves.toMatchObject({
      trigger: 'manual',
      summary: '',
      error: 'no result message; tool failures (1): model saw: nope',
    })
  })
})

describe('toReport', () => {
  const ok = { result: success(), error: null, seen: [] }
  it('sums turns, cost and tokens over every query and takes the summary from the last', () => {
    const report = toReport('cron', '2024-01-01T00:00:00.000Z', [
      ok,
      {
        result: success({ result: 'cio says', num_turns: 2, total_cost_usd: 1 }),
        error: null,
        seen: [],
      },
    ])
    expect(report).toMatchObject({
      trigger: 'cron',
      startedAt: '2024-01-01T00:00:00.000Z',
      finishedAt: expect.stringMatching(/T/),
      turns: 6,
      costUsd: 1.25,
      model: 'claude-a,claude-b',
      inputTokens: 72,
      outputTokens: 24,
      summary: 'cio says',
      error: null,
    })
  })
  it('lists thrown errors and failed results, and notes a missing final result', () => {
    expect(
      toReport('t', 's', [{ result: undefined, error: 'sdk exploded', seen: [] }, ok]).error,
    ).toBe('sdk exploded')
    expect(toReport('t', 's', [{ result: failure(), error: null, seen: [] }, ok]).error).toBe(
      'error_max_turns: too long; gave up',
    )
    expect(
      toReport('t', 's', [
        { result: undefined, error: 'sdk exploded', seen: [] },
        { result: failure(), error: null, seen: [] },
        ok,
      ]).error,
    ).toBe('sdk exploded; error_max_turns: too long; gave up')
    expect(
      toReport('t', 's', [
        ok,
        { result: success({ result: 'middle' }), error: null, seen: [] },
        { result: success({ result: 'last' }), error: null, seen: [] },
      ]),
    ).toMatchObject({ summary: 'last', error: null })
    expect(toReport('t', 's', [ok, ok, { result: undefined, error: null, seen: [] }]).error).toBe(
      'no result message',
    )
    expect(
      toReport('t', 's', [
        ok,
        { result: success({ is_error: true, result: 'api down' }), error: null, seen: [] },
      ]),
    ).toMatchObject({
      summary: '',
      error: 'api down',
    })
    expect(toReport('t', 's', [ok, { result: undefined, error: null, seen: [] }])).toMatchObject({
      summary: '',
      error: 'no result message',
      model: 'claude-a,claude-b',
    })
    expect(toReport('t', 's', [])).toMatchObject({
      model: 'unknown',
      turns: 0,
      costUsd: 0,
      summary: '',
      error: 'no result message',
    })
  })
})

describe('withToolFailures', () => {
  const report = {
    trigger: 't',
    startedAt: 's',
    finishedAt: 'f',
    model: 'm',
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    turns: 1,
    summary: 'ok',
    error: null,
  }
  it('leaves a clean report alone', () => {
    toolFailures.length = 0
    expect(withToolFailures(report)).toBe(report)
  })
  it('appends distinct failures, at most three, to a null or existing error', () => {
    toolFailures.push('a', 'a', 'b', 'c', 'd')
    expect(withToolFailures(report).error).toBe('tool failures (5): a | b | c')
    toolFailures.length = 0
    expect(withToolFailures(report, ['x', 'x']).error).toBe('tool failures (2): x')
    toolFailures.push('a', 'a', 'b', 'c', 'd')
    expect(withToolFailures({ ...report, error: 'crashed' }).error).toBe(
      'crashed; tool failures (5): a | b | c',
    )
    toolFailures.length = 0
  })
})

describe('toolResultErrors', () => {
  it('extracts the text the model saw from failed tool results only', () => {
    const message = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', is_error: true, content: 'MCP server not connected' },
          {
            type: 'tool_result',
            is_error: true,
            content: [{ type: 'text', text: 'boom' }, { type: 'image' }, 'raw', null, { text: 7 }],
          },
          { type: 'tool_result', is_error: false, content: 'fine' },
          { type: 'text', text: 'hello' },
          'string block',
        ],
      },
    }
    expect(toolResultErrors(message)).toEqual([
      'model saw: MCP server not connected',
      'model saw: boom    ',
    ])
    expect(toolResultErrors({ type: 'user', message: { content: 'plain' } })).toEqual([])
    expect(
      toolResultErrors({
        type: 'assistant',
        message: { content: [{ type: 'tool_result', is_error: true, content: 'ignored' }] },
      }),
    ).toEqual([])
    expect(toolResultErrors('text')).toEqual([])
    expect(toolResultErrors(undefined)).toEqual([])
    expect(
      toolResultErrors({ type: 'user', message: { content: [{ type: 'text', is_error: true }] } }),
    ).toEqual([])
    expect(toolResultErrors({ type: 'user', message: null })).toEqual([])
    expect(toolResultErrors(null)).toEqual([])
    expect(
      toolResultErrors({
        type: 'user',
        message: { content: [{ type: 'tool_result', is_error: true, content: 5 }] },
      }),
    ).toEqual(['model saw: '])
    const long = 'y'.repeat(400)
    expect(
      toolResultErrors({
        type: 'user',
        message: { content: [{ type: 'tool_result', is_error: true, content: long }] },
      }),
    ).toEqual([`model saw: ${'y'.repeat(300)}`])
  })
})

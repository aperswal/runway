import type {
  McpSdkServerConfigWithInstance,
  SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import type * as Sdk from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CIO_TOOL_NAMES, cioServer } from './cio-tools.ts'
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
  createFund: vi.fn<(body: unknown) => Promise<string>>().mockResolvedValue('created'),
  reallocateFund: vi
    .fn<(id: string, share: number) => Promise<string>>()
    .mockResolvedValue('resized'),
  retireFund: vi.fn<(id: string, reason: string) => Promise<string>>().mockResolvedValue('retired'),
})
const serverFor = (site: ReturnType<typeof fakeSite>) => cioServer(site as unknown as SiteClient)

describe('cioServer', () => {
  it('registers the cio tools under the exported names', () => {
    const server = serverFor(fakeSite())
    expect(server.name).toBe('cio')
    expect(toolsOf(server).map((t) => `mcp__cio__${t.name}`)).toEqual(CIO_TOOL_NAMES)
  })
  it('describes create_fund for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'create_fund')).toEqual({
      description:
        'Spin up a new fund with its own mandate and capital share. Its manager agent exists from the next run.',
      properties: {
        id: { type: 'string', description: 'lowercase slug, e.g. ai-capex' },
        name: { type: 'string', maxLength: 60 },
        mandate: {
          type: 'string',
          maxLength: 1500,
          description: 'the strategy brief its manager will run',
        },
        share: {
          type: 'number',
          exclusiveMinimum: 0,
          maximum: 1,
          description: 'fraction of equity it may deploy; all active funds must sum to at most 1',
        },
      },
      required: ['id', 'name', 'mandate', 'share'],
    }))
  it('describes reallocate_fund for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'reallocate_fund')).toEqual({
      description:
        "Reset a fund's book to this fraction of equity. Its high water mark resets too; the drawdown rules keep applying from there.",
      properties: {
        id: { type: 'string' },
        share: { type: 'number', exclusiveMinimum: 0, maximum: 1 },
      },
      required: ['id', 'share'],
    }))
  it('describes retire_fund for the model', () =>
    expect(contractOf(serverFor(fakeSite()), 'retire_fund')).toEqual({
      description: 'Spin a fund down. It must hold no positions; close them first.',
      properties: { id: { type: 'string' }, reason: { type: 'string', maxLength: 120 } },
      required: ['id', 'reason'],
    }))
  it('create_fund posts the fund', async () => {
    const site = fakeSite()
    const input = { id: 'ai-capex', name: 'AI capex', mandate: 'Follow the spend.', share: 0.3 }
    await expect(handlerOf(serverFor(site), 'create_fund')(input, {})).resolves.toEqual({
      content: [{ type: 'text', text: 'created' }],
    })
    expect(site.createFund).toHaveBeenCalledWith(input)
  })
  it('reallocate_fund forwards id and share', async () => {
    const site = fakeSite()
    await expect(
      handlerOf(serverFor(site), 'reallocate_fund')({ id: 'alpha', share: 0.5 }, {}),
    ).resolves.toEqual({ content: [{ type: 'text', text: 'resized' }] })
    expect(site.reallocateFund).toHaveBeenCalledWith('alpha', 0.5)
  })
  it('retire_fund forwards id and reason', async () => {
    const site = fakeSite()
    await expect(
      handlerOf(serverFor(site), 'retire_fund')({ id: 'alpha', reason: 'no edge' }, {}),
    ).resolves.toEqual({ content: [{ type: 'text', text: 'retired' }] })
    expect(site.retireFund).toHaveBeenCalledWith('alpha', 'no edge')
  })
})

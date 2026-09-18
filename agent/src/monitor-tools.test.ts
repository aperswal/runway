import type * as Sdk from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { MONITOR_TOOL_NAMES, monitorServer } from './monitor-tools.ts'
import type { SiteClient } from './site.ts'

type Definition = {
  name: string
  description: string
  inputSchema: Record<string, z.ZodType>
  handler: (input: unknown, extra: unknown) => Promise<unknown>
}
vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof Sdk>()),
  createSdkMcpServer: (options: { name: string; tools: Definition[] }) => ({
    type: 'sdk',
    name: options.name,
    instance: options.tools,
  }),
}))

type FakeSite = { createMonitor: Mock; listMonitors: Mock; resolveMonitor: Mock }
const fakeSite = (): FakeSite => ({
  createMonitor: vi.fn(() => Promise.resolve('{"id":1}')),
  listMonitors: vi.fn(() => Promise.resolve('[]')),
  resolveMonitor: vi.fn(() => Promise.resolve('{"status":"done"}')),
})

const toolsOf = (site: FakeSite): Definition[] =>
  (monitorServer(site as unknown as SiteClient) as unknown as { instance: Definition[] }).instance
const contract = (d: Definition): { description: string; schema: unknown } => ({
  description: d.description,
  schema: z.toJSONSchema(z.object(d.inputSchema)),
})

describe('monitorServer', () => {
  it('exposes the three monitor tools under their SDK names', () => {
    expect(toolsOf(fakeSite()).map((t) => `mcp__monitors__${t.name}`)).toEqual(MONITOR_TOOL_NAMES)
    expect(monitorServer(fakeSite() as unknown as SiteClient).name).toBe('monitors')
  })
  it('describes set_monitor for the model', () => {
    const [set] = toolsOf(fakeSite())
    expect(contract(set!)).toEqual({
      description:
        'Watch a dated event (earnings, FDA, launch). The monitor is flagged DUE in your context once the time passes, and shown on the public Stats page under Watching.',
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        properties: {
          fund: { type: 'string' },
          symbol: { type: 'string' },
          event: {
            type: 'string',
            maxLength: 120,
            description: 'earnings, FDA decision, product launch, contract award, unlock, ...',
          },
          eventAt: { type: 'string', description: 'ISO 8601 UTC datetime of the event' },
          watch: {
            type: 'string',
            maxLength: 1000,
            description:
              'what to check and what you will do either way, e.g. "guide above $1.2B: hold to target; miss: close"',
          },
        },
        required: ['fund', 'symbol', 'event', 'eventAt', 'watch'],
      },
    })
  })
  it('describes list_monitors and resolve_monitor for the model', () => {
    const [, list, resolve] = toolsOf(fakeSite())
    expect(list!.description).toBe('List the fund monitors with their status.')
    expect(contract(list!).schema).toMatchObject({ required: ['fund'] })
    expect(resolve!.description).toBe(
      'Close a monitor once you have acted on the event, recording the outcome.',
    )
    expect(contract(resolve!).schema).toMatchObject({
      properties: {
        id: { type: 'integer', exclusiveMinimum: 0 },
        outcome: { type: 'string', maxLength: 1000, description: 'what happened and what you did' },
      },
      required: ['id', 'outcome'],
    })
  })
  it('forwards each call to the site', async () => {
    const site = fakeSite()
    const [set, list, resolve] = toolsOf(site)
    const input = { fund: 'a', symbol: 'AAPL', event: 'earnings', eventAt: 'x', watch: 'w' }
    await expect(set!.handler(input, {})).resolves.toEqual({
      content: [{ type: 'text', text: '{"id":1}' }],
    })
    expect(site.createMonitor).toHaveBeenCalledWith(input)
    await expect(list!.handler({ fund: 'a' }, {})).resolves.toEqual({
      content: [{ type: 'text', text: '[]' }],
    })
    expect(site.listMonitors).toHaveBeenCalledWith('a')
    await expect(resolve!.handler({ id: 3, outcome: 'beat' }, {})).resolves.toEqual({
      content: [{ type: 'text', text: '{"status":"done"}' }],
    })
    expect(site.resolveMonitor).toHaveBeenCalledWith(3, 'beat')
  })
})

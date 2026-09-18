import type * as Sdk from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { JOB_TOOL_NAMES, jobServer } from './job-tools.ts'
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

type FakeSite = { createJob: Mock; listJobs: Mock; cancelJob: Mock }
const fakeSite = (): FakeSite => ({
  createJob: vi.fn(() => Promise.resolve('{"id":1}')),
  listJobs: vi.fn(() => Promise.resolve('[]')),
  cancelJob: vi.fn(() => Promise.resolve('{"status":"done"}')),
})

const handlerOf = (d: Definition): Definition['handler'] => d.handler
const toolsOf = (site: FakeSite): Definition[] =>
  (jobServer(site as unknown as SiteClient) as unknown as { instance: Definition[] }).instance
const contract = (d: Definition): { description: string; schema: unknown } => ({
  description: d.description,
  schema: z.toJSONSchema(z.object(d.inputSchema)),
})

describe('jobServer', () => {
  it('exposes the three job tools under their SDK names', () => {
    expect(toolsOf(fakeSite()).map((t) => `mcp__jobs__${t.name}`)).toEqual(JOB_TOOL_NAMES)
    expect(jobServer(fakeSite() as unknown as SiteClient).name).toBe('jobs')
  })
  it('describes schedule_job for the model', () => {
    const [schedule] = toolsOf(fakeSite())
    expect(contract(schedule!)).toEqual({
      description:
        'Leave a script running on a cadence in its own sandboxed container. Each run output is saved as a note on your fund, so you can collect data between runs (funding rates, review counts, prices, anything a script can fetch).',
      schema: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        additionalProperties: false,
        properties: {
          fund: { type: 'string' },
          name: {
            type: 'string',
            maxLength: 60,
            description: 'what the job collects, e.g. "BTC funding rate every hour"',
          },
          script: {
            type: 'string',
            maxLength: 4000,
            description:
              'bash script; python3, node, curl and the sources CLI are available; it sees SITE_URL and DATA_TOKEN only; print the findings to stdout',
          },
          everyMinutes: { type: 'integer', minimum: 15, maximum: 1440 },
          runs: {
            type: 'integer',
            exclusiveMinimum: 0,
            maximum: 96,
            description: 'how many times to run before the job retires',
          },
          timeoutSeconds: { type: 'integer', exclusiveMinimum: 0, maximum: 900 },
        },
        required: ['fund', 'name', 'script', 'everyMinutes', 'runs'],
      },
    })
  })
  it('describes list_jobs and cancel_job for the model', () => {
    const [, list, cancel] = toolsOf(fakeSite())
    expect(list!.description).toBe(
      'List the fund scheduled jobs with their last output and remaining runs.',
    )
    expect(cancel!.description).toBe('Stop a scheduled job.')
    expect(z.toJSONSchema(z.object(list!.inputSchema)).required).toEqual(['fund'])
    expect(z.toJSONSchema(z.object(cancel!.inputSchema)).properties).toMatchObject({
      id: { type: 'integer', exclusiveMinimum: 0 },
    })
  })
  it('forwards each call to the site', async () => {
    const site = fakeSite()
    const [schedule, list, cancel] = toolsOf(site)
    const input = { fund: 'alpha', name: 'j', script: 'echo', everyMinutes: 60, runs: 3 }
    await expect(handlerOf(schedule!)(input, {})).resolves.toEqual({
      content: [{ type: 'text', text: '{"id":1}' }],
    })
    expect(site.createJob).toHaveBeenCalledWith(input)
    await expect(handlerOf(list!)({ fund: 'alpha' }, {})).resolves.toEqual({
      content: [{ type: 'text', text: '[]' }],
    })
    expect(site.listJobs).toHaveBeenCalledWith('alpha')
    await expect(handlerOf(cancel!)({ id: 4 }, {})).resolves.toEqual({
      content: [{ type: 'text', text: '{"status":"done"}' }],
    })
    expect(site.cancelJob).toHaveBeenCalledWith(4)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCli } from './cli.ts'
import { SOURCES_HELP } from './registry.ts'

afterEach(() => vi.unstubAllGlobals())

describe('runCli', () => {
  it('prints the command result as JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"hits":[]}')))
    await expect(runCli(['hn', 'search', '--q', 'x'], {})).resolves.toEqual({
      output: '[]',
      exitCode: 0,
    })
  })
  it('includes usage on a usage error', async () => {
    const result = await runCli(['nope'], {})
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.output)).toEqual({
      error: expect.stringContaining('Unknown source "nope"'),
      usage: SOURCES_HELP,
    })
  })
  it('reports other errors without usage', async () => {
    const result = await runCli(['apify', 'run', '--actor', 'a', '--input', '{}'], {})
    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.output)).toEqual({
      error: 'APIFY_TOKEN is not set. Set the APIFY_TOKEN environment variable and retry.',
    })
  })
})

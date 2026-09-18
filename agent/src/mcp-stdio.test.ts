import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { describe, expect, it, vi } from 'vitest'
import { ConfigError } from './errors.ts'
import { STDIO_SERVERS, isStdioServer, serve, stdioServer } from './mcp-stdio.ts'

const env = { SITE_URL: 'https://runway.test', RUNWAY_TOKEN: 'rt' }

describe('mcp-stdio', () => {
  it('knows its server names', () => {
    expect(STDIO_SERVERS).toEqual(['manager'])
    expect(isStdioServer('manager')).toBe(true)
    expect(isStdioServer('cio')).toBe(false)
    expect(isStdioServer(undefined)).toBe(false)
  })

  it('builds the named server against the site', () => {
    const server = stdioServer('manager', env)
    expect(server.name).toBe('runway')
    const names = (server.instance as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools
    expect(Object.keys(names)).toEqual([
      'record_analysis',
      'record_observation',
      'record_note',
      'record_lesson',
      'query_research',
      'schedule_job',
      'list_jobs',
      'cancel_job',
      'set_monitor',
      'list_monitors',
      'resolve_monitor',
      'open_position',
      'close_position',
      'cancel_order',
      'adjust_exits',
      'option_contracts',
      'query_trades',
    ])
  })

  it('lists and calls its tools over a real MCP transport', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('[]'))),
    )
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await stdioServer('manager', env).instance.connect(serverSide)
    const client = new Client({ name: 'test', version: '0' })
    await client.connect(clientSide)
    const listed = await client.listTools()
    expect(listed.tools.map((t) => t.name)).toContain('query_trades')
    expect(listed.tools.map((t) => t.name)).toContain('open_position')
    expect(listed.tools.find((t) => t.name === 'record_lesson')?.inputSchema).toMatchObject({
      type: 'object',
      required: expect.arrayContaining(['fund', 'kind', 'lesson']),
    })
    const result = await client.callTool({ name: 'query_trades', arguments: { fund: 'quant' } })
    expect(result).toMatchObject({ content: [{ type: 'text', text: '[]' }] })
    await client.close()
    vi.unstubAllGlobals()
  })

  it('refuses unknown servers and missing settings', () => {
    expect(() => stdioServer('cio', env)).toThrow(ConfigError)
    expect(() => stdioServer('manager', { SITE_URL: 'x' })).toThrow('SITE_URL and RUNWAY_TOKEN')
    expect(() => stdioServer('manager', { RUNWAY_TOKEN: 'x' })).toThrow(ConfigError)
  })

  it('connects the server over the given transport, stdio by default', async () => {
    const transport = { start: vi.fn().mockResolvedValue(undefined), send: vi.fn(), close: vi.fn() }
    await serve('manager', env, transport)
    expect(transport.start).toHaveBeenCalledTimes(1)
    expect(new StdioServerTransport()).toBeInstanceOf(StdioServerTransport)
  })
})

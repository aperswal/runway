import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError } from './errors.ts'
import { mcpToolNames, parseMcpConfig, readMcpConfig } from './mcp.ts'

const secrets = { PAPERS_TOKEN: 'tok', HOME: '/home/x' }

describe('parseMcpConfig', () => {
  it('parses stdio and remote servers and substitutes placeholders everywhere', () => {
    const text = JSON.stringify({
      servers: {
        local: {
          type: 'stdio',
          command: 'node',
          args: ['server.js', '${HOME}'],
          env: { KEY: '${PAPERS_TOKEN}' },
          timeout: 5000,
        },
        papers: {
          type: 'http',
          url: 'https://x.test/${PAPERS_TOKEN}',
          headers: { authorization: 'Bearer ${PAPERS_TOKEN}' },
          alwaysLoad: true,
        },
        events: { type: 'sse', url: 'https://x.test/sse' },
      },
    })
    expect(parseMcpConfig(text, secrets)).toEqual({
      local: {
        type: 'stdio',
        command: 'node',
        args: ['server.js', '/home/x'],
        env: { KEY: 'tok' },
        timeout: 5000,
      },
      papers: {
        type: 'http',
        url: 'https://x.test/tok',
        headers: { authorization: 'Bearer tok' },
        alwaysLoad: true,
      },
      events: { type: 'sse', url: 'https://x.test/sse' },
    })
  })
  it('keeps only the keys that were given', () => {
    const servers = parseMcpConfig(
      JSON.stringify({
        servers: { a: { command: 'x' }, b: { type: 'sse', url: 'https://x.test' } },
      }),
      {},
    )
    expect(Object.keys(servers.a ?? {})).toEqual(['command'])
    expect(Object.keys(servers.b ?? {})).toEqual(['type', 'url'])
  })
  it('joins several issues with a semicolon', () => {
    const text = JSON.stringify({
      servers: { a: { command: '' }, b: { type: 'http', url: 'nope' } },
    })
    expect(() => parseMcpConfig(text, {})).toThrow(/servers\.a\.command .*; servers\.b\.url /)
  })
  it('returns no servers for an empty file', () =>
    expect(parseMcpConfig(JSON.stringify({ servers: {} }), {})).toEqual({}))
  it('names a missing or blank secret', () => {
    const text = JSON.stringify({ servers: { a: { command: 'x', env: { K: '${MISSING}' } } } })
    expect(() => parseMcpConfig(text, {})).toThrow(
      new ConfigError('mcp.json: a references MISSING, which is not set in the environment'),
    )
    expect(() => parseMcpConfig(text, { MISSING: '' })).toThrow(ConfigError)
  })
  it('rejects bad names, urls, timeouts and shapes with every issue listed', () => {
    const text = JSON.stringify({
      servers: { Bad: { command: 'x' }, ok: { type: 'http', url: 'nope', timeout: 10 } },
    })
    expect(() => parseMcpConfig(text, {})).toThrow(/^mcp\.json: .*servers\.Bad/)
    expect(() => parseMcpConfig(JSON.stringify({ servers: { aB: { command: 'x' } } }), {})).toThrow(
      /servers\.aB/,
    )
    expect(() =>
      parseMcpConfig(JSON.stringify({ servers: { ok: { type: 'http', url: 'nope' } } }), {}),
    ).toThrow('mcp.json: servers.ok.url Invalid URL')
    expect(() =>
      parseMcpConfig(JSON.stringify({ servers: { ok: { command: 'x', timeout: 10 } } }), {}),
    ).toThrow(/servers\.ok\.timeout/)
  })
})

describe('readMcpConfig', () => {
  it('returns no servers when the file is absent', () =>
    expect(readMcpConfig(path.join(tmpdir(), 'missing-mcp.json'), {})).toEqual({}))
  it('reads and parses the file when present', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mcp-'))
    const file = path.join(dir, 'mcp.json')
    writeFileSync(file, JSON.stringify({ servers: { a: { command: 'x', args: ['${HOME}'] } } }))
    expect(readMcpConfig(file, secrets)).toEqual({ a: { command: 'x', args: ['/home/x'] } })
  })
})

describe('mcpToolNames', () => {
  it('maps server names to the SDK permission prefix', () =>
    expect(
      mcpToolNames({ a: { command: 'x' }, b: { type: 'http', url: 'https://x.test' } }),
    ).toEqual(['mcp__a', 'mcp__b']))
  it('is empty without servers', () => expect(mcpToolNames({})).toEqual([]))
})

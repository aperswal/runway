import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  agentEnv,
  loadConfig,
  loadDataEnv,
  loadSourceKeys,
  requireKey,
  defaultMcpConfigPath,
  loadMcpServers,
} from './env.ts'
import { ConfigError, MissingEnvError, SiteError } from './errors.ts'

afterEach(() => vi.unstubAllEnvs())

const base = {
  SITE_URL: 'https://runway.test',
  INTERNAL_TOKEN: 'internal-token-long-enough',
  DATA_TOKEN: 'data-token-long-enough-too',
  PATH: '/usr/bin',
  HOME: '/home/runway',
}

describe('loadConfig', () => {
  it('parses a valid environment with defaults', () =>
    expect(loadConfig({ ...base, AGENT_MODEL: '' })).toEqual({
      ...base,
      CLAUDE_CODE_OAUTH_TOKEN: undefined,
      AGENT_MODEL: undefined,
      AGENT_MAX_TURNS: 120,
      MCP_CONFIG_PATH: undefined,
    }))
  it('reads process.env by default', () => {
    vi.stubEnv('SITE_URL', 'not a url')
    expect(() => loadConfig()).toThrow(ConfigError)
  })
  it('loads MCP servers from the configured path, or none when the default file is empty', () => {
    expect(loadMcpServers({ MCP_CONFIG_PATH: undefined })).toEqual({})
    expect(defaultMcpConfigPath()).toMatch(/^\/.*\/mcp\.json$/)
    expect(loadMcpServers({ MCP_CONFIG_PATH: '/nonexistent/mcp.json' }, {})).toEqual({})
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'mcp-')), 'mcp.json')
    writeFileSync(file, JSON.stringify({ servers: { a: { command: '${HOME}/bin/x' } } }))
    expect(loadMcpServers({ MCP_CONFIG_PATH: file }, { HOME: '/h' })).toEqual({
      a: { command: '/h/bin/x' },
    })
  })
  it('names every invalid field', () =>
    expect(() => loadConfig({ ...base, SITE_URL: 'nope', AGENT_MAX_TURNS: '-1' })).toThrow(
      /config: SITE_URL .*; AGENT_MAX_TURNS /,
    ))
})

describe('loadSourceKeys', () => {
  it('reads process.env by default', () => expect(loadSourceKeys()).toBeTypeOf('object'))
  it('treats empty strings as unset', () =>
    expect(loadSourceKeys({ APIFY_TOKEN: 'x', YOUTUBE_API_KEY: '' })).toEqual({
      APIFY_TOKEN: 'x',
      YOUTUBE_API_KEY: undefined,
      REDDIT_CLIENT_ID: undefined,
      REDDIT_CLIENT_SECRET: undefined,
      OPENAI_API_KEY: undefined,
    }))
})

describe('agentEnv', () => {
  it('adds only the source keys that are set', () =>
    expect(
      agentEnv(loadConfig(base), { APIFY_TOKEN: 'tok', YOUTUBE_API_KEY: undefined }),
    ).toStrictEqual({
      PATH: base.PATH,
      HOME: base.HOME,
      SITE_URL: base.SITE_URL,
      DATA_TOKEN: base.DATA_TOKEN,
      APIFY_TOKEN: 'tok',
    }))
  it('reads the source keys from the process by default', () => {
    vi.stubEnv('REDDIT_CLIENT_ID', 'rid')
    expect(agentEnv(loadConfig(base))).toMatchObject({ REDDIT_CLIENT_ID: 'rid' })
  })
})

describe('requireKey', () => {
  it('returns a present key', () =>
    expect(requireKey({ APIFY_TOKEN: 'x' }, 'APIFY_TOKEN')).toBe('x'))
  it('names the missing variable', () => {
    const error = (() => {
      try {
        requireKey({}, 'OPENAI_API_KEY')
        return undefined
      } catch (e) {
        return e
      }
    })()
    expect(error).toBeInstanceOf(MissingEnvError)
    expect(error).toMatchObject({
      variable: 'OPENAI_API_KEY',
      message: 'OPENAI_API_KEY is not set. Set the OPENAI_API_KEY environment variable and retry.',
    })
  })
})

describe('errors', () => {
  it('SiteError carries status and body', () =>
    expect(new SiteError(502, 'bad gateway')).toMatchObject({
      name: 'SiteError',
      status: 502,
      body: 'bad gateway',
      message: 'site 502: bad gateway',
    }))
  it('ConfigError is named', () =>
    expect(new ConfigError('x')).toMatchObject({ name: 'ConfigError', message: 'x' }))
})

describe('loadDataEnv', () => {
  it('reads process.env by default', () => {
    vi.stubEnv('SITE_URL', 'https://runway.test')
    vi.stubEnv('DATA_TOKEN', 'data-token-long-enough-too')
    expect(loadDataEnv()).toEqual({
      SITE_URL: 'https://runway.test',
      DATA_TOKEN: 'data-token-long-enough-too',
    })
  })
  it('keeps only the data fields', () =>
    expect(loadDataEnv(base)).toEqual({ SITE_URL: base.SITE_URL, DATA_TOKEN: base.DATA_TOKEN }))
  it('fails with one message when either is missing', () =>
    expect(() => loadDataEnv({ SITE_URL: base.SITE_URL })).toThrow(
      new ConfigError('SITE_URL and DATA_TOKEN must be set to reach market data'),
    ))
})

describe('loadConfig optional fields', () => {
  it('keeps non-empty optional values', () =>
    expect(
      loadConfig({
        ...base,
        CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
        AGENT_MODEL: 'claude-x',
        AGENT_MAX_TURNS: '12',
      }),
    ).toMatchObject({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      AGENT_MODEL: 'claude-x',
      AGENT_MAX_TURNS: 12,
    }))
})

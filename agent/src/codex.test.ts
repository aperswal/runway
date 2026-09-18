import { EventEmitter } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codexArgs, codexConfig, redact, runCodex, secretsOf } from './codex.ts'
import { loadConfig } from './env.ts'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))

const base = {
  SITE_URL: 'https://runway.test',
  INTERNAL_TOKEN: 'internal-token-long-enough',
  DATA_TOKEN: 'data-token-long-enough-too',
  PATH: '/usr/bin',
  HOME: '/home/runway',
}
const run = (overrides: Record<string, string> = {}, auth = '{"tokens":{}}') => ({
  prompt: 'context',
  instructions: 'be a manager',
  auth,
  config: loadConfig({ ...base, ...overrides }),
  tokens: { research: 'research-token' },
})

type Child = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { end: (text: string) => void }
  kill: () => void
  pid: number
}
const fakeChild = (): Child =>
  Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    stdin: { end: vi.fn() },
    kill: vi.fn(),
    pid: 4242,
  })

describe('codexConfig', () => {
  it('declares the sandbox, shell policy and one stdio server per tool group', () => {
    const text = codexConfig({ research: 'rt' }, 'https://runway.test')
    expect(text).toContain('sandbox_mode = "workspace-write"')
    expect(text).toContain('network_access = true')
    expect(text).toContain('[mcp_servers.runway]')
    expect(text).toContain('"manager"]')
    expect(text).toContain('RUNWAY_TOKEN = "rt"')
    expect(codexConfig({}, 'https://runway.test')).toContain('RUNWAY_TOKEN = ""')
  })
})

describe('secretsOf and redact', () => {
  it('collects env values, tokens and auth strings of secret length and blanks them', () => {
    const secrets = secretsOf(
      run({}, '{"tokens":{"access_token":"tok-abcdefgh","id":"x"},"n":1}'),
      { PATH: '/usr/bin', HOME: '/home/runway', APIFY_TOKEN: 'apify_api_secret' },
    )
    expect(secrets).toEqual(['apify_api_secret', 'research-token', 'tok-abcdefgh'])
    expect(redact('APIFY_TOKEN=apify_api_secret tok-abcdefgh /usr/bin', secrets)).toBe(
      'APIFY_TOKEN=[redacted] [redacted] /usr/bin',
    )
    expect(secretsOf(run({}, '{}'), {})).toEqual(['research-token'])
  })
})

describe('codexArgs', () => {
  it('runs exec headless with the prompt and an optional model', () => {
    expect(codexArgs(run(), '/w', '/h/last.md')).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--dangerously-bypass-approvals-and-sandbox',
      '-C',
      '/w',
      '-o',
      '/h/last.md',
      '-',
    ])
    expect(codexArgs(run({ CODEX_MODEL: 'gpt-5.6' }), '/w', '/h/last.md')).toContain('gpt-5.6')
  })
})

describe('runCodex', () => {
  afterEach(() => mocks.spawn.mockReset())

  it('writes instructions, auth and config, then returns the last message as the report', async () => {
    const child = fakeChild()
    mocks.spawn.mockImplementation(
      (_cmd: string, args: string[], opts: { env: Record<string, string> }) => {
        const last = args[args.indexOf('-o') + 1]!
        const workdir = args[args.indexOf('-C') + 1]!
        void (async () => {
          expect(await readFile(path.join(workdir, 'AGENTS.md'), 'utf8')).toBe('be a manager')
          expect(await readFile(path.join(opts.env.CODEX_HOME!, 'auth.json'), 'utf8')).toBe(
            '{"tokens":{}}',
          )
          expect(await readFile(path.join(opts.env.CODEX_HOME!, 'config.toml'), 'utf8')).toContain(
            '[mcp_servers.runway]',
          )
          await writeFile(last, 'PROPOSE nothing')
          child.stdout.emit(
            'data',
            Buffer.from('{"type":"item.completed"}\n{"type":"item.completed"}\n'),
          )
          child.emit('close', 0)
        })()
        return child
      },
    )
    const outcome = await runCodex(run(), { PATH: '/usr/bin' })
    expect(outcome.error).toBeNull()
    expect(outcome.result).toMatchObject({
      subtype: 'success',
      result: 'PROPOSE nothing',
      num_turns: 2,
      total_cost_usd: 0,
    })
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([expect.stringContaining('codex.js'), 'exec']),
      {
        env: expect.objectContaining({ PATH: '/usr/bin', CODEX_HOME: expect.any(String) }),
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    expect(child.stdin.end).toHaveBeenCalledWith('context')
  })

  it('reports a failed or empty run', async () => {
    const child = fakeChild()
    mocks.spawn.mockImplementation(() => {
      setTimeout(() => {
        child.stderr.emit('data', Buffer.from('boom'))
        child.emit('close', 1)
      }, 0)
      return child
    })
    const outcome = await runCodex(run(), {})
    expect(outcome.result).toBeUndefined()
    expect(outcome.error).toBe('codex exited 1: boom')
  })

  it('kills the whole process group of a run that outlives the time budget', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      child.emit('close', null)
      return true
    })
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        void vi.advanceTimersByTimeAsync(46 * 60 * 1000)
      })
      return child
    })
    const outcome = await runCodex(run(), {})
    expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
    expect(mocks.spawn.mock.calls[0]?.[2]).toMatchObject({ detached: true })
    expect(outcome.error).toBe('codex exited null: ')
    vi.useRealTimers()
  })

  it('falls back to killing the child when the group cannot be signalled', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const child = fakeChild()
    child.kill = vi.fn(() => child.emit('close', null))
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH')
    })
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        void vi.advanceTimersByTimeAsync(46 * 60 * 1000)
      })
      return child
    })
    const outcome = await runCodex(run(), {})
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('could not kill the codex process group'),
    )
    expect(outcome.error).toBe('codex exited null: ')
    vi.useRealTimers()
  })

  it('reports a runner that cannot even start', async () => {
    mocks.spawn.mockImplementation(() => {
      throw new Error('spawn ENOENT')
    })
    const outcome = await runCodex(run(), {})
    expect(outcome).toEqual({ result: undefined, error: 'spawn ENOENT', seen: [] })
  })
})

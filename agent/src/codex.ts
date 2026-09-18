import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentConfig } from './env.ts'
import { errorMessage, log } from './log.ts'
import { STDIO_SERVERS } from './mcp-stdio.ts'
import type { QueryOutcome } from './run.ts'

export const CODEX_MINUTES = 45
const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000
const RUN_TIMEOUT_MS = CODEX_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND
const MAX_OUTPUT = 200_000
const DETAIL_CHARS = 2000
const MIN_SECRET_LENGTH = 8
const PUBLIC_ENV = new Set(['PATH', 'HOME', 'SITE_URL'])
const STDIO_ENTRY = new URL('./mcp-stdio-main.js', import.meta.url).pathname
const require = createRequire(import.meta.url)
const codexEntry = (): string =>
  path.join(path.dirname(require.resolve('@openai/codex/package.json')), 'bin', 'codex.js')

export type CodexRun = {
  prompt: string
  instructions: string
  auth: string
  config: AgentConfig
  tokens: Record<string, string>
}

const toml = (value: string): string => JSON.stringify(value)

export function codexConfig(tokens: Record<string, string>, siteUrl: string): string {
  const servers = STDIO_SERVERS.map((name) =>
    [
      `[mcp_servers.runway]`,
      `command = "node"`,
      `args = [${toml(STDIO_ENTRY)}, ${toml(name)}]`,
      `env = { SITE_URL = ${toml(siteUrl)}, RUNWAY_TOKEN = ${toml(tokens.research ?? '')} }`,
    ].join('\n'),
  )
  return [
    'sandbox_mode = "workspace-write"',
    'approval_policy = "never"',
    '[sandbox_workspace_write]',
    'network_access = true',
    '[shell_environment_policy]',
    'inherit = "all"',
    ...servers,
  ].join('\n')
}

export function codexArgs(run: CodexRun, workdir: string, lastMessage: string): string[] {
  const model = run.config.CODEX_MODEL === undefined ? [] : ['-m', run.config.CODEX_MODEL]
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--dangerously-bypass-approvals-and-sandbox',
    '-C',
    workdir,
    '-o',
    lastMessage,
    ...model,
    '-',
  ]
}

const countTurns = (jsonl: string): number =>
  jsonl.split('\n').filter((line) => line.includes('"item.completed"')).length

const success = (text: string, turns: number): SDKResultMessage =>
  ({
    type: 'result',
    subtype: 'success',
    result: text,
    num_turns: turns,
    total_cost_usd: 0,
    modelUsage: {},
    errors: [],
  }) as unknown as SDKResultMessage

const jsonStrings = (text: string): string[] => {
  const found: string[] = []
  JSON.parse(text, (_key, value: unknown) => {
    if (typeof value === 'string') {
      found.push(value)
    }
    return value
  })
  return found
}

export function secretsOf(run: CodexRun, shellEnv: Record<string, string>): string[] {
  const auth = jsonStrings(run.auth)
  const env = Object.entries(shellEnv).flatMap(([key, value]) =>
    PUBLIC_ENV.has(key) ? [] : [value],
  )
  return [...env, ...Object.values(run.tokens), ...auth].filter(
    (value) => value.length >= MIN_SECRET_LENGTH,
  )
}

export const redact = (text: string, secrets: string[]): string =>
  secrets.reduce((out, secret) => out.split(secret).join('[redacted]'), text)

async function prepare(run: CodexRun): Promise<{ workdir: string; home: string }> {
  const workdir = await mkdtemp(path.join(os.tmpdir(), 'codex-run-'))
  const home = await mkdtemp(path.join(os.homedir(), 'codex-home-'))
  await writeFile(path.join(workdir, 'AGENTS.md'), run.instructions)
  await writeFile(path.join(home, 'auth.json'), run.auth)
  await writeFile(path.join(home, 'config.toml'), codexConfig(run.tokens, run.config.SITE_URL))
  return { workdir, home }
}

function killTree(child: ChildProcess): void {
  try {
    process.kill(-Number(child.pid), 'SIGKILL')
  } catch (error) {
    log.error({ message: 'could not kill the codex process group', error: errorMessage(error) })
    child.kill('SIGKILL')
  }
}

function execute(
  args: string[],
  prompt: string,
  env: Record<string, string>,
): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [codexEntry(), ...args], {
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    child.stdin.end(prompt)
    let stdout = ''
    const collect = (chunk: Buffer): void => {
      stdout = `${stdout}${chunk.toString()}`.slice(-MAX_OUTPUT)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => killTree(child), RUN_TIMEOUT_MS)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, code })
    })
  })
}

export async function runCodex(
  run: CodexRun,
  shellEnv: Record<string, string>,
): Promise<QueryOutcome> {
  try {
    const { workdir, home } = await prepare(run)
    const lastMessage = path.join(home, 'last.md')
    const env = { ...shellEnv, CODEX_HOME: home }
    const { stdout, code } = await execute(codexArgs(run, workdir, lastMessage), run.prompt, env)
    const report = await readFile(lastMessage, 'utf8').catch(() => '')
    if (code !== 0 || report.length === 0) {
      const detail = redact(stdout.slice(-DETAIL_CHARS), secretsOf(run, shellEnv))
      log.error({ message: 'codex run failed', code, detail })
      return { result: undefined, error: `codex exited ${code}: ${detail}`, seen: [] }
    }
    return { result: success(report, countTurns(stdout)), error: null, seen: [] }
  } catch (error) {
    return { result: undefined, error: errorMessage(error), seen: [] }
  }
}

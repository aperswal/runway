import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { ConfigError } from './errors.ts'

const NAME = /^[a-z][a-z0-9-]*$/
const PLACEHOLDER = /\$\{([A-Z0-9_]+)\}/g
const MS_PER_SECOND = 1000

const common = {
  timeout: z.number().int().min(MS_PER_SECOND).optional(),
  alwaysLoad: z.boolean().optional(),
}
const stdio = z.object({
  type: z.literal('stdio').optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  ...common,
})
const remote = z.object({
  type: z.enum(['http', 'sse']),
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  ...common,
})
const fileSchema = z.object({ servers: z.record(z.string().regex(NAME), z.union([stdio, remote])) })

export type McpServers = Record<string, McpServerConfig>
export type Secrets = Record<string, string | undefined>

type Stdio = z.infer<typeof stdio>
type Remote = z.infer<typeof remote>

const fill =
  (secrets: Secrets, where: string) =>
  (value: string): string =>
    value.replace(PLACEHOLDER, (_match, name: string) => {
      const secret = secrets[name]
      if (secret === undefined || secret.length === 0) {
        throw new ConfigError(
          `mcp.json: ${where} references ${name}, which is not set in the environment`,
        )
      }
      return secret
    })

const fillRecord = (
  record: Record<string, string>,
  sub: (v: string) => string,
): Record<string, string> => Object.fromEntries(Object.entries(record).map(([k, v]) => [k, sub(v)]))

type Extras = { timeout?: number | undefined; alwaysLoad?: boolean | undefined }
type Exact = { timeout?: number; alwaysLoad?: boolean }

const optionalFields = (s: Extras): Exact => ({
  ...(s.timeout === undefined ? {} : { timeout: s.timeout }),
  ...(s.alwaysLoad === undefined ? {} : { alwaysLoad: s.alwaysLoad }),
})

function resolveStdio(server: Stdio, sub: (v: string) => string): McpServerConfig {
  return {
    ...(server.type === undefined ? {} : { type: server.type }),
    ...optionalFields(server),
    command: sub(server.command),
    ...(server.args === undefined ? {} : { args: server.args.map(sub) }),
    ...(server.env === undefined ? {} : { env: fillRecord(server.env, sub) }),
  }
}

function resolveRemote(server: Remote, sub: (v: string) => string): McpServerConfig {
  return {
    type: server.type,
    ...optionalFields(server),
    url: sub(server.url),
    ...(server.headers === undefined ? {} : { headers: fillRecord(server.headers, sub) }),
  }
}

export function parseMcpConfig(text: string, secrets: Secrets): McpServers {
  const parsed = fileSchema.safeParse(JSON.parse(text))
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')
    throw new ConfigError(`mcp.json: ${detail}`)
  }
  return Object.fromEntries(
    Object.entries(parsed.data.servers).map(([name, server]) => {
      const sub = fill(secrets, name)
      return [name, 'command' in server ? resolveStdio(server, sub) : resolveRemote(server, sub)]
    }),
  )
}

export function readMcpConfig(path: string, secrets: Secrets): McpServers {
  if (!existsSync(path)) {
    return {}
  }
  return parseMcpConfig(readFileSync(path).toString(), secrets)
}

export const mcpToolNames = (servers: McpServers): string[] =>
  Object.keys(servers).map((name) => `mcp__${name}`)

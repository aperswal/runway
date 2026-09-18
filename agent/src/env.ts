import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { ConfigError, MissingEnvError, describeIssues } from './errors.ts'
import { readMcpConfig, type McpServers } from './mcp.ts'

const MIN_TOKEN_LENGTH = 16
const DEFAULT_MAX_TURNS = 120

const optional = z
  .string()
  .optional()
  .transform((v) => (v !== undefined && v.length > 0 ? v : undefined))

const schema = z.object({
  SITE_URL: z.url(),
  INTERNAL_TOKEN: z.string().min(MIN_TOKEN_LENGTH),
  DATA_TOKEN: z.string().min(MIN_TOKEN_LENGTH),
  CLAUDE_CODE_OAUTH_TOKEN: optional,
  AGENT_MODEL: optional,
  MANAGER_MODEL: optional,
  CODEX_MODEL: optional,
  RESEARCH_TOKEN: optional,
  AGENT_MAX_TURNS: z.coerce.number().int().positive().default(DEFAULT_MAX_TURNS),
  MCP_CONFIG_PATH: optional,
  PATH: z.string().min(1),
  HOME: z.string().min(1),
})

export type AgentConfig = z.infer<typeof schema>

const dataSchema = z.object({ SITE_URL: z.url(), DATA_TOKEN: z.string().min(MIN_TOKEN_LENGTH) })
export type DataEnv = z.infer<typeof dataSchema>

export function loadDataEnv(source: Record<string, string | undefined> = process.env): DataEnv {
  const parsed = dataSchema.safeParse(source)
  if (!parsed.success) {
    throw new ConfigError('SITE_URL and DATA_TOKEN must be set to reach market data')
  }
  return parsed.data
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AgentConfig {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    throw new ConfigError(`config: ${describeIssues(parsed.error.issues)}`)
  }
  return parsed.data
}

const sourceKeySchema = z.object({
  APIFY_TOKEN: optional,
  YOUTUBE_API_KEY: optional,
  REDDIT_CLIENT_ID: optional,
  REDDIT_CLIENT_SECRET: optional,
  OPENAI_API_KEY: optional,
})

export type SourceKeys = Partial<z.infer<typeof sourceKeySchema>>
export type SourceKeyName = keyof SourceKeys

export function loadSourceKeys(
  source: Record<string, string | undefined> = process.env,
): SourceKeys {
  return sourceKeySchema.parse(source)
}

const defined = (entries: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(entries).filter(([, v]) => v !== undefined) as [string, string][],
  )

export function agentEnv(
  config: Pick<AgentConfig, 'PATH' | 'HOME' | 'SITE_URL' | 'DATA_TOKEN'>,
  keys: SourceKeys = loadSourceKeys(),
): Record<string, string> {
  return {
    PATH: config.PATH,
    HOME: config.HOME,
    SITE_URL: config.SITE_URL,
    DATA_TOKEN: config.DATA_TOKEN,
    ...defined(keys),
  }
}

export function requireKey(keys: SourceKeys, name: SourceKeyName): string {
  const value = keys[name]
  if (value === undefined) {
    throw new MissingEnvError(name)
  }
  return value
}

export const defaultMcpConfigPath = (): string =>
  fileURLToPath(new URL('../mcp.json', import.meta.url))

export function loadMcpServers(
  config: Pick<AgentConfig, 'MCP_CONFIG_PATH'>,
  source: Record<string, string | undefined> = process.env,
): McpServers {
  return readMcpConfig(config.MCP_CONFIG_PATH ?? defaultMcpConfigPath(), source)
}

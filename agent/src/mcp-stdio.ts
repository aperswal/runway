import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ConfigError } from './errors.ts'
import { jobTools } from './job-tools.ts'
import { monitorTools } from './monitor-tools.ts'
import { researchTools } from './research-tools.ts'
import { SiteClient } from './site.ts'
import { traderTools, type ToolList } from './tools.ts'

export const STDIO_SERVERS = ['manager'] as const
export type StdioServer = (typeof STDIO_SERVERS)[number]
export type StdioMcp = { name: string; instance: McpServer }

const VERSION = '1.0.0'

type Handler = (args: Record<string, unknown>, extra: unknown) => Promise<CallToolResult>
type Definition = {
  name: string
  description: string
  inputSchema: ZodRawShapeCompat
  handler: Handler
}

function build(name: string, tools: ToolList): StdioMcp {
  const instance = new McpServer({ name, version: VERSION })
  for (const tool of tools as unknown as Definition[]) {
    instance.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      (args: Record<string, unknown>, extra: unknown) => tool.handler(args, extra),
    )
  }
  return { name, instance }
}

const managerServer = (site: SiteClient): StdioMcp =>
  build('runway', [
    ...researchTools(site),
    ...jobTools(site),
    ...monitorTools(site),
    ...traderTools(site),
  ])

const BUILDERS: Record<StdioServer, (site: SiteClient) => StdioMcp> = {
  manager: managerServer,
}

export const isStdioServer = (name: string | undefined): name is StdioServer =>
  STDIO_SERVERS.some((s) => s === name)

export function stdioServer(
  name: string | undefined,
  env: Record<string, string | undefined>,
): StdioMcp {
  if (!isStdioServer(name)) {
    throw new ConfigError(`mcp-stdio: server must be one of ${STDIO_SERVERS.join(', ')}`)
  }
  const siteUrl = env.SITE_URL
  const token = env.RUNWAY_TOKEN
  if (siteUrl === undefined || token === undefined) {
    throw new ConfigError('mcp-stdio: SITE_URL and RUNWAY_TOKEN are required')
  }
  return BUILDERS[name](new SiteClient(siteUrl, token))
}

export async function serve(
  name: string | undefined,
  env: Record<string, string | undefined>,
  transport: Transport = new StdioServerTransport(),
): Promise<void> {
  await stdioServer(name, env).instance.connect(transport)
}

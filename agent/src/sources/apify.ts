import { z } from 'zod'
import type { SourceKeys } from '../env.ts'
import { requireKey } from '../env.ts'
import type { Flags } from './args.ts'
import { intFlag, requireFlag } from './args.ts'
import { fetchJson, parseJson } from './http.ts'
import type { Source } from './source.ts'

const ACTS_URL = 'https://api.apify.com/v2/acts'
const STORE_URL = 'https://api.apify.com/v2/store'
const DEFAULT_TIMEOUT_SECONDS = 300
const DEFAULT_MAX = 10
const DESCRIPTION_LENGTH = 160

const inputSchema = z.record(z.string(), z.unknown())
const itemsSchema = z.array(z.record(z.string(), z.unknown()))
const storeSchema = z.object({
  data: z.object({
    items: z.array(
      z.object({
        username: z.string(),
        name: z.string(),
        title: z.string().optional(),
        description: z.string().nullable().optional(),
        pricingModel: z.string().nullable().optional(),
        stats: z.object({ totalUsers30Days: z.number().optional() }).optional(),
      }),
    ),
  }),
})
const buildSchema = z.object({ data: z.object({ inputSchema: z.string().nullable().optional() }) })
const propertySchema = z.object({
  type: z.string().optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  prefill: z.unknown().optional(),
  enum: z.array(z.unknown()).optional(),
})
const definitionSchema = z.object({
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), propertySchema).optional(),
})

type ApifyRun = { actor: string; count: number; items: Record<string, unknown>[] }
type ApifyActor = {
  actor: string
  title: string
  users30d: number
  pricing: string
  description: string
}
type ApifyInput = {
  name: string
  type: string
  description: string
  default: unknown
  options: unknown[]
}
type ApifySchema = { actor: string; required: string[]; inputs: ApifyInput[] }

const SCRAPER = 'apify~cheerio-scraper'
const DEFAULT_MAX_PAGES = 20
const DEFAULT_SELECTOR = 'body'
const TEXT_LIMIT = 4000

export const selectorFunction = (selector: string | undefined): string => {
  const target = JSON.stringify(selector ?? DEFAULT_SELECTOR)
  return `async function pageFunction(context) { const { $, request } = context; const items = $(${target}).map((i, el) => $(el).text().replace(/\\s+/g, ' ').trim()).get(); return { url: request.url, title: $('title').first().text().trim(), items: items.map((t) => t.slice(0, ${TEXT_LIMIT})) }; }`
}

const authHeaders = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
})

export const apify: Source = {
  name: 'apify',
  commands: [
    {
      name: 'run',
      usage: "apify run --actor <owner/name> --input '<json>' [--timeout 300]",
      about: 'run any Apify actor synchronously and return its dataset items',
      run: async (flags: Flags, keys: SourceKeys): Promise<ApifyRun> => {
        const token = requireKey(keys, 'APIFY_TOKEN')
        const actor = requireFlag(flags, 'actor').replace('/', '~')
        const input = parseJson(inputSchema, requireFlag(flags, 'input'), '--input')
        const timeout = intFlag(flags, 'timeout', DEFAULT_TIMEOUT_SECONDS)
        const url = `${ACTS_URL}/${encodeURIComponent(actor)}/run-sync-get-dataset-items?timeout=${timeout}`
        const items = await fetchJson(url, itemsSchema, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
        return { actor, count: items.length, items }
      },
    },
    {
      name: 'search',
      usage: 'apify search --q "<what to scrape>" [--max 10]',
      about:
        'find actors on the Apify store by popularity; then read their inputs with apify schema',
      run: async (
        flags: Flags,
        keys: SourceKeys,
      ): Promise<{ query: string; actors: ApifyActor[] }> => {
        const token = requireKey(keys, 'APIFY_TOKEN')
        const q = requireFlag(flags, 'q')
        const max = intFlag(flags, 'max', DEFAULT_MAX)
        const url = `${STORE_URL}?search=${encodeURIComponent(q)}&limit=${max}&sortBy=popularity`
        const store = await fetchJson(url, storeSchema, { headers: authHeaders(token) })
        const actors = store.data.items.map((a) => ({
          actor: `${a.username}/${a.name}`,
          title: a.title ?? a.name,
          users30d: a.stats?.totalUsers30Days ?? 0,
          pricing: a.pricingModel ?? 'unknown',
          description: (a.description ?? '').slice(0, DESCRIPTION_LENGTH),
        }))
        return { query: q, actors }
      },
    },
    {
      name: 'schema',
      usage: 'apify schema --actor <owner/name>',
      about: "read an actor's input fields, types, defaults and options before running it",
      run: async (flags: Flags, keys: SourceKeys): Promise<ApifySchema> => {
        const token = requireKey(keys, 'APIFY_TOKEN')
        const actor = requireFlag(flags, 'actor').replace('/', '~')
        const url = `${ACTS_URL}/${encodeURIComponent(actor)}/builds/default`
        const build = await fetchJson(url, buildSchema, { headers: authHeaders(token) })
        const definition = parseJson(
          definitionSchema,
          build.data.inputSchema ?? '{}',
          'input schema',
        )
        const inputs = Object.entries(definition.properties ?? {}).map(([name, p]) => ({
          name,
          type: p.type ?? 'unknown',
          description: p.description ?? '',
          default: p.default ?? p.prefill ?? null,
          options: p.enum ?? [],
        }))
        return { actor, required: definition.required ?? [], inputs }
      },
    },
    {
      name: 'scrape',
      usage:
        "apify scrape --urls <url,url> [--selector '<css>'] [--page-function '<js>'] [--max 20] [--timeout 300]",
      about:
        'scrape pages with the generic cheerio-scraper: --selector returns the text of matching elements per page, or supply your own pageFunction; test with one url, then schedule_job the working command',
      run: async (flags: Flags, keys: SourceKeys): Promise<ApifyRun> => {
        const token = requireKey(keys, 'APIFY_TOKEN')
        const urls = requireFlag(flags, 'urls')
          .split(',')
          .map((u) => u.trim())
          .filter((u) => u.length > 0)
        const timeout = intFlag(flags, 'timeout', DEFAULT_TIMEOUT_SECONDS)
        const input = {
          startUrls: urls.map((url) => ({ url })),
          maxRequestsPerCrawl: intFlag(flags, 'max', DEFAULT_MAX_PAGES),
          pageFunction: flags['page-function'] ?? selectorFunction(flags.selector),
          proxyConfiguration: { useApifyProxy: true },
        }
        const url = `${ACTS_URL}/${SCRAPER}/run-sync-get-dataset-items?timeout=${timeout}`
        const items = await fetchJson(url, itemsSchema, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(input),
        })
        return { actor: SCRAPER, count: items.length, items }
      },
    },
  ],
}

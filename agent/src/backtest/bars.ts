import { z } from 'zod'
import { SiteError } from '../errors.ts'
import type { Bar } from './strategies.ts'

const barSchema = z.object({
  t: z.string(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number(),
})
const pageSchema = z.object({
  bars: z.record(z.string(), z.array(barSchema)),
  next_page_token: z.string().nullable(),
})

const DAY_MS = 86_400_000
const PAGE_LIMIT = 10_000
const DATE_LENGTH = 10

export type BarSource = { siteUrl: string; dataToken: string }

const isCrypto = (symbol: string): boolean => symbol.includes('/')

export async function fetchDailyBars(
  source: BarSource,
  symbols: string[],
  days: number,
  now: Date,
): Promise<Record<string, Bar[]>> {
  const start = new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, DATE_LENGTH)
  const groups = [
    { dataset: 'stock-bars', symbols: symbols.filter((s) => !isCrypto(s)) },
    { dataset: 'crypto-bars', symbols: symbols.filter(isCrypto) },
  ]
  const fetched = await Promise.all(
    groups
      .filter((group) => group.symbols.length > 0)
      .map((group) => fetchGroup(source, group.dataset, group.symbols, start)),
  )
  return Object.assign({}, ...fetched) as Record<string, Bar[]>
}

async function fetchGroup(
  source: BarSource,
  dataset: string,
  symbols: string[],
  start: string,
): Promise<Record<string, Bar[]>> {
  const query = new URLSearchParams({
    symbols: symbols.join(','),
    timeframe: '1Day',
    start,
    limit: String(PAGE_LIMIT),
  })
  if (dataset === 'stock-bars') {
    query.set('feed', 'iex')
  }
  const res = await fetch(`${source.siteUrl}/data/${dataset}?${query.toString()}`, {
    headers: { authorization: `Bearer ${source.dataToken}` },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new SiteError(res.status, text)
  }
  const parsed = pageSchema.safeParse(JSON.parse(text))
  if (!parsed.success) {
    throw new SiteError(res.status, `unexpected bars shape: ${parsed.error.message}`)
  }
  return parsed.data.bars
}

import { z } from 'zod'
import type { Flags } from './args.ts'
import { requireFlag } from './args.ts'
import { SourceError } from '../errors.ts'
import { fetchJson, withQuery } from './http.ts'
import type { Source } from './source.ts'

const CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/'
const HEADERS = { 'user-agent': 'Mozilla/5.0 (runway research)' }
const DEFAULT_RANGE = '3mo'
const DEFAULT_INTERVAL = '1d'
const MS_PER_SECOND = 1000
const PERCENT = 100
const DATE_LENGTH = 10

const metaSchema = z.object({
  symbol: z.string(),
  currency: z.string().nullish(),
  exchangeName: z.string().nullish(),
  regularMarketPrice: z.number().nullish(),
  chartPreviousClose: z.number().nullish(),
  regularMarketTime: z.number().nullish(),
})
const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: metaSchema,
          timestamp: z.array(z.number()).nullish(),
          indicators: z.object({
            quote: z.array(z.object({ close: z.array(z.number().nullable()) })),
          }),
        }),
      )
      .nullable(),
    error: z.object({ description: z.string() }).nullable(),
  }),
})

type Chart = NonNullable<z.infer<typeof chartSchema>['chart']['result']>[number]
type Quote = {
  symbol: string
  currency: string
  exchange: string
  price: number | null
  previousClose: number | null
  changePct: number | null
  asOf: string | null
}
type Candle = { date: string; close: number }

const isoAt = (seconds: number): string => new Date(seconds * MS_PER_SECOND).toISOString()

async function chart(symbol: string, range: string, interval: string): Promise<Chart> {
  const url = withQuery(`${CHART_URL}${encodeURIComponent(symbol)}`, { range, interval })
  const body = await fetchJson(url, chartSchema, { headers: HEADERS })
  const [result] = body.chart.result ?? []
  if (result === undefined) {
    throw new SourceError(`${symbol}: ${body.chart.error?.description ?? 'no data'}`)
  }
  return result
}

const changePct = (price: number | null, previous: number | null): number | null =>
  price === null || previous === null || previous === 0
    ? null
    : ((price - previous) / previous) * PERCENT

function toQuote(c: Chart): Quote {
  const price = c.meta.regularMarketPrice ?? null
  const previousClose = c.meta.chartPreviousClose ?? null
  const time = c.meta.regularMarketTime
  return {
    symbol: c.meta.symbol,
    currency: c.meta.currency ?? '',
    exchange: c.meta.exchangeName ?? '',
    price,
    previousClose,
    changePct: changePct(price, previousClose),
    asOf: time === null || time === undefined ? null : isoAt(time),
  }
}

function toCandles(c: Chart): Candle[] {
  const closes = c.indicators.quote[0]?.close ?? []
  return (c.timestamp ?? []).flatMap((t, i) => {
    const close = closes[i]
    return close === null || close === undefined
      ? []
      : [{ date: isoAt(t).slice(0, DATE_LENGTH), close }]
  })
}

export const world: Source = {
  name: 'world',
  commands: [
    {
      name: 'quote',
      usage: 'world quote --symbols 7203.T,^N225,^FTSE,EURUSD=X,BZ=F',
      about:
        'latest price and day change for any Yahoo Finance symbol: non-US stocks (7203.T, SAP.DE, 0700.HK), indexes (^N225, ^STOXX50E), FX (EURUSD=X), commodities (BZ=F)',
      run: async (flags: Flags): Promise<Quote[]> => {
        const symbols = requireFlag(flags, 'symbols')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s !== '')
        const charts = await Promise.all(symbols.map((s) => chart(s, '5d', DEFAULT_INTERVAL)))
        return charts.map(toQuote)
      },
    },
    {
      name: 'history',
      usage: 'world history --symbol 7203.T [--range 3mo] [--interval 1d]',
      about: 'daily closes for a Yahoo Finance symbol (ranges 5d, 1mo, 3mo, 6mo, 1y, 5y)',
      run: async (flags: Flags): Promise<Candle[]> =>
        toCandles(
          await chart(
            requireFlag(flags, 'symbol'),
            flags.range ?? DEFAULT_RANGE,
            flags.interval ?? DEFAULT_INTERVAL,
          ),
        ),
    },
  ],
}

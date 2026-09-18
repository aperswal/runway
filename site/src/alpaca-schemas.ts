import { z } from 'zod'

const money = z.coerce.number()

export const accountSchema = z.object({
  equity: money,
  cash: money,
  daytrade_count: z
    .number()
    .nullish()
    .transform((n) => n ?? 0),
  pattern_day_trader: z
    .boolean()
    .nullish()
    .transform((b) => b ?? false),
})

export const positionSchema = z.object({
  symbol: z.string(),
  qty: money,
  avg_entry_price: money,
  current_price: money,
  market_value: money,
  unrealized_pl: money,
  asset_class: z.enum(['us_equity', 'crypto', 'us_option']),
})

export const orderSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  status: z.string(),
  filled_avg_price: money.nullable(),
  filled_qty: money.nullable(),
})

export const assetSchema = z.object({
  symbol: z.string(),
  class: z.enum(['us_equity', 'crypto', 'us_option']),
  tradable: z.boolean(),
  fractionable: z.boolean(),
  status: z.string(),
})

export const contractSchema = z.object({
  symbol: z.string(),
  tradable: z.boolean(),
  status: z.string(),
})

export const clockSchema = z.object({
  is_open: z.boolean(),
  next_open: z.string(),
  next_close: z.string(),
})

export const newsSchema = z.object({
  news: z.array(
    z.object({
      headline: z.string(),
      created_at: z.string(),
      symbols: z.array(z.string()),
      source: z.string(),
    }),
  ),
})

export const latestTradesSchema = z.object({
  trades: z.record(z.string(), z.object({ p: z.number() })),
})

export type Account = z.infer<typeof accountSchema>
export type Position = z.infer<typeof positionSchema>
export type Order = z.infer<typeof orderSchema>
export type Asset = z.infer<typeof assetSchema>
export type Clock = z.infer<typeof clockSchema>
export type Headline = z.infer<typeof newsSchema>['news'][number]

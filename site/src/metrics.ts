import type { Trade } from './db/schema'

const PERCENT = 100
const MS_PER_HOUR = 3_600_000

export type TradeMetrics = {
  closed: number
  winRate: number | null
  avgReturnPct: number | null
  avgHoldHours: number | null
  profitFactor: number | null
  realizedPl: number
}

export const tradeReturnPct = (t: Trade): number =>
  (((t.exitPrice ?? t.entryPrice) - t.entryPrice) / t.entryPrice) * PERCENT
export const tradePl = (t: Trade): number => ((t.exitPrice ?? t.entryPrice) - t.entryPrice) * t.qty

const holdHours = (t: Trade): number =>
  (new Date(t.closedAt ?? t.openedAt).getTime() - new Date(t.openedAt).getTime()) / MS_PER_HOUR

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length

export function tradeMetrics(closedTrades: Trade[]): TradeMetrics {
  const settled = closedTrades.filter((t) => t.qty > 0)
  const pls = settled.map(tradePl)
  const gains = pls.reduce((sum, pl) => sum + Math.max(0, pl), 0)
  const losses = pls.reduce((sum, pl) => sum - Math.min(0, pl), 0)
  return {
    closed: settled.length,
    winRate:
      settled.length === 0 ? null : (pls.filter((pl) => pl > 0).length / settled.length) * PERCENT,
    avgReturnPct: mean(settled.map(tradeReturnPct)),
    avgHoldHours: mean(settled.map(holdHours)),
    profitFactor: losses === 0 ? null : gains / losses,
    realizedPl: pls.reduce((sum, pl) => sum + pl, 0),
  }
}

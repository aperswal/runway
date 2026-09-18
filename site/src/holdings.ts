import type { HeldPosition, Trade } from './db/schema'
import { contractMultiplier, positionSymbol } from './symbols'

export type Holding = {
  fund: string
  symbol: string
  qty: number
  value: number
  unrealizedPl: number
  entryPrice: number
  currentPrice: number
  stop: number
  target: number
  trailPct: number | null
  entryStop: number | null
  horizon: string
  reason: string
  openedAt: string
}

const unpriced = (t: Trade): HeldPosition => ({
  symbol: positionSymbol(t.symbol),
  qty: t.qty,
  marketValue: t.notional,
  currentPrice: t.entryPrice,
  unrealizedPl: 0,
})

export function toHolding(t: Trade, held: Map<string, HeldPosition>): Holding {
  const p = held.get(positionSymbol(t.symbol)) ?? unpriced(t)
  return {
    fund: t.fund,
    symbol: t.symbol,
    qty: t.qty,
    value: t.qty * p.currentPrice * contractMultiplier(t.symbol),
    unrealizedPl: (p.currentPrice - t.entryPrice) * t.qty * contractMultiplier(t.symbol),
    entryPrice: t.entryPrice,
    currentPrice: p.currentPrice,
    stop: t.stop,
    target: t.target,
    trailPct: t.trailPct,
    entryStop: t.entryStop,
    horizon: t.horizon,
    reason: t.reason,
    openedAt: t.openedAt,
  }
}

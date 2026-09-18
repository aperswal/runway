import type { Account, Position } from './alpaca'
import { positionSymbol } from './symbols'
import { snapshots, type HeldPosition, type Trade } from './db/schema'
import { rescueFunds } from './allocation'
import { LIQUIDATION_REASON } from './liquidation'
import { errorMessage, log } from './log'
import { reconcileTrade } from './reconcile'
import { nowIso } from './time'
import { activeTrades, canExitNow, closeTrade, type TradeDeps } from './trades'
import { ratchetStop } from './exit-adjust'

export type ExitDecision = 'hold' | 'stop' | 'target'

export function decideExit(trade: Pick<Trade, 'stop' | 'target'>, price: number): ExitDecision {
  if (price <= trade.stop) {
    return 'stop'
  }
  if (price >= trade.target) {
    return 'target'
  }
  return 'hold'
}

export const toHeld = (p: Position): HeldPosition => ({
  symbol: p.symbol,
  qty: p.qty,
  marketValue: p.market_value,
  currentPrice: p.current_price,
  unrealizedPl: p.unrealized_pl,
})

export async function runCycle(deps: TradeDeps): Promise<void> {
  const [account, clock, active, positions] = await Promise.all([
    deps.alpaca.account(),
    deps.alpaca.clock(),
    activeTrades(deps.db),
    deps.alpaca.positions(),
  ])
  await deps.db.insert(snapshots).values({
    takenAt: nowIso(),
    equity: account.equity,
    cash: account.cash,
    positions: positions.map(toHeld),
  })
  const held = new Set(positions.map((p) => positionSymbol(p.symbol)))
  const knownPrices = new Map(positions.map((p) => [positionSymbol(p.symbol), p.current_price]))
  const now = new Date()
  await Promise.all(active.map((trade) => reconcileTrade(deps, trade, held, now)))
  const open = (await activeTrades(deps.db)).filter((t) => t.status === 'open')
  const enforceable = open.filter((t) => canExitNow(t, clock.is_open))
  const priceOf = await pricesFor(deps, enforceable, knownPrices)
  await Promise.all(
    enforceable.map((trade) =>
      enforceExit(deps, trade, priceOf(trade), { account, marketOpen: clock.is_open }),
    ),
  )
  await rescueFunds(deps.db, now)
}

async function pricesFor(
  deps: TradeDeps,
  enforceable: Trade[],
  knownPrices: Map<string, number>,
): Promise<(trade: Trade) => number | undefined> {
  const unknown = enforceable.filter((t) => !knownPrices.has(positionSymbol(t.symbol)))
  const fetched =
    unknown.length > 0 ? await deps.alpaca.latestPrices(unknown.map((t) => t.symbol)) : {}
  return (trade) => knownPrices.get(positionSymbol(trade.symbol)) ?? fetched[trade.symbol]
}

async function enforceExit(
  deps: TradeDeps,
  trade: Trade,
  price: number | undefined,
  session: { account: Account; marketOpen: boolean },
): Promise<void> {
  try {
    if (price === undefined) {
      log.error({ message: 'no price for open trade', symbol: trade.symbol })
      return
    }
    if (trade.liquidate) {
      await closeTrade(deps, trade, { reason: LIQUIDATION_REASON, price, ...session })
      return
    }
    const current = await ratchetStop(deps.db, trade, price)
    const decision = decideExit(current, price)
    if (decision !== 'hold') {
      await closeTrade(deps, current, { reason: decision, price, ...session })
    }
  } catch (error) {
    log.error({
      message: 'exit failed',
      tradeId: trade.id,
      symbol: trade.symbol,
      error: errorMessage(error),
    })
  }
}

import { eq } from 'drizzle-orm'
import { isTerminalOrder, positionSymbol } from './symbols'
import { trades, type Trade } from './db/schema'
import { errorMessage, log } from './log'
import { minutesBetween, nowIso } from './time'
import { activate, finalize, setStatus, type TradeDeps } from './trades'

const UNSUBMITTED_GRACE_MINUTES = 5
const MISSING_GRACE_MINUTES = 10
export const MISSING_AT_BROKER = 'position missing at broker'

export async function reconcileTrade(
  deps: TradeDeps,
  trade: Trade,
  held: Set<string>,
  now: Date,
): Promise<void> {
  try {
    await reconcileByStatus(deps, trade, held, now)
  } catch (error) {
    log.error({
      message: 'reconcile failed',
      tradeId: trade.id,
      status: trade.status,
      error: errorMessage(error),
    })
  }
}

type Reconciler = (deps: TradeDeps, trade: Trade, held: Set<string>, now: Date) => Promise<void>

const RECONCILERS: Record<Exclude<Trade['status'], 'closed' | 'cancelled'>, Reconciler> = {
  pending: (deps, trade, _held, now) => reconcilePending(deps, trade, now),
  closing: (deps, trade) => reconcileClosing(deps, trade),
  open: reconcileOpen,
}

const reconcileByStatus: Reconciler = (deps, trade, held, now) =>
  trade.status === 'closed' || trade.status === 'cancelled'
    ? Promise.resolve()
    : RECONCILERS[trade.status](deps, trade, held, now)

async function reconcilePending(deps: TradeDeps, trade: Trade, now: Date): Promise<void> {
  if (trade.orderId === null) {
    if (minutesBetween(trade.openedAt, now) > UNSUBMITTED_GRACE_MINUTES) {
      await deps.db.delete(trades).where(eq(trades.id, trade.id))
    }
    return
  }
  const order = await deps.alpaca.order(trade.orderId)
  if (order.status === 'filled') {
    await activate(deps, trade.id, order)
    return
  }
  await settlePending(deps, { ...trade, orderId: trade.orderId }, order.status, now)
}

const aliveWindowEnded = (trade: Trade, now: Date): boolean =>
  trade.expiresAt !== null && trade.expiresAt <= now.toISOString()

const replacementLimit = (trade: Trade, expired: boolean, dead: boolean): number | null =>
  dead && !expired ? trade.limitPrice : null

async function settlePending(
  deps: TradeDeps,
  trade: Trade & { orderId: string },
  status: string,
  now: Date,
): Promise<void> {
  const expired = aliveWindowEnded(trade, now)
  const dead = isTerminalOrder(status)
  if (!expired && !dead) {
    return
  }
  const limit = replacementLimit(trade, expired, dead)
  if (limit !== null) {
    await replaceOrder(deps, trade, limit)
    return
  }
  if (!dead) {
    await deps.alpaca.cancelOrder(trade.orderId)
  }
  await setStatus(deps.db, trade.id, 'pending', {
    status: 'cancelled',
    exitReason: expired ? 'alive window ended' : `order ${status}`,
    closedAt: nowIso(),
  })
}

async function replaceOrder(deps: TradeDeps, trade: Trade, limit: number): Promise<void> {
  const replaced = await deps.alpaca.buy({ symbol: trade.symbol, qty: trade.qty, limit })
  await deps.db.update(trades).set({ orderId: replaced.id }).where(eq(trades.id, trade.id))
}

async function reconcileClosing(deps: TradeDeps, trade: Trade): Promise<void> {
  if (trade.closeOrderId === null) {
    await setStatus(deps.db, trade.id, 'closing', { status: 'open', exitReason: null })
    return
  }
  const order = await deps.alpaca.order(trade.closeOrderId)
  if (order.status === 'filled') {
    await finalize(deps, trade.id, order.filled_avg_price ?? trade.entryPrice)
  } else if (isTerminalOrder(order.status)) {
    await setStatus(deps.db, trade.id, 'closing', {
      status: 'open',
      exitReason: null,
      closeOrderId: null,
    })
  }
}

async function reconcileOpen(
  deps: TradeDeps,
  trade: Trade,
  held: Set<string>,
  now: Date,
): Promise<void> {
  const settled = minutesBetween(trade.openedAt, now) > MISSING_GRACE_MINUTES
  if (settled && !held.has(positionSymbol(trade.symbol))) {
    await setStatus(deps.db, trade.id, 'open', {
      status: 'closed',
      exitReason: MISSING_AT_BROKER,
      exitPrice: trade.entryPrice,
      closedAt: nowIso(),
    })
  }
}

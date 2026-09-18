import { and, eq, inArray, ne, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { settleTrade } from './allocation'
import { type Account, type Alpaca, type Order } from './alpaca'
import { contractMultiplier, isCrypto, isOption, tradesExtended } from './symbols'
import type { Db } from './db/client'
import { ACTIVE_STATUSES, trades, type Trade } from './db/schema'
import type { PostJob } from './env'
import { StateError } from './errors'
import { assertCanClose } from './guardrails'
import { errorMessage, log } from './log'
import { nowIso } from './time'

const MAX_REASON = 150
const CENTS_SCALE = 100

const QTY_PLACES = 6

export const closePositionInput = z.object({
  fund: z.string().min(1).optional(),
  reason: z.string().trim().min(1).max(MAX_REASON),
  fraction: z.number().gt(0).lt(1).optional(),
})

export const lotOf = (symbol: string, fund: string | undefined): SQL[] =>
  fund === undefined
    ? [eq(trades.symbol, symbol)]
    : [eq(trades.symbol, symbol), eq(trades.fund, fund)]

export type TradeDeps = { db: Db; alpaca: Alpaca; postQueue: Queue<PostJob> }

export const activeTrades = (db: Db): Promise<Trade[]> =>
  db
    .select()
    .from(trades)
    .where(inArray(trades.status, [...ACTIVE_STATUSES]))

export async function findOpenTrade(db: Db, symbol: string, fund?: string): Promise<Trade> {
  const [trade] = await db
    .select()
    .from(trades)
    .where(and(eq(trades.status, 'open'), ...lotOf(symbol, fund)))
  if (trade === undefined) {
    throw new StateError(`no open position in ${symbol}${fund === undefined ? '' : ` for ${fund}`}`)
  }
  return trade
}

export function requirePrice(prices: Record<string, number>, symbol: string): number {
  const price = prices[symbol]
  if (price === undefined) {
    throw new StateError(`no recent price for ${symbol}`)
  }
  return price
}

export async function activate(deps: TradeDeps, id: number, filled: Order): Promise<Trade> {
  const [trade] = await deps.db
    .update(trades)
    .set({
      status: 'open',
      entryStop: sql`${trades.stop}`,
      qty: filled.filled_qty ?? 0,
      entryPrice: filled.filled_avg_price ?? 0,
      notional:
        (filled.filled_qty ?? 0) *
        (filled.filled_avg_price ?? 0) *
        contractMultiplier(filled.symbol),
    })
    .where(and(eq(trades.id, id), eq(trades.status, 'pending')))
    .returning()
  if (trade === undefined) {
    throw new StateError(`trade ${id} was not pending`)
  }
  await enqueuePost(deps, { tradeId: trade.id, kind: 'buy' })
  return trade
}

export type Exit = { reason: string; account: Account; marketOpen: boolean; price: number }

const EXTENDED_SELL_BUFFER = 0.995

export const canExitNow = (trade: Pick<Trade, 'symbol' | 'qty'>, marketOpen: boolean): boolean =>
  marketOpen || isCrypto(trade.symbol) || tradesExtended(trade.symbol, trade.qty)

const partQty = (trade: Pick<Trade, 'symbol' | 'qty'>, fraction: number): number => {
  const whole = isOption(trade.symbol) || Number.isInteger(trade.qty)
  const part = whole
    ? Math.floor(trade.qty * fraction)
    : Number((trade.qty * fraction).toFixed(QTY_PLACES))
  if (part <= 0 || part >= trade.qty) {
    throw new StateError(`cannot sell ${fraction} of ${trade.qty} ${trade.symbol}`)
  }
  return part
}

async function recordPiece(
  deps: TradeDeps,
  trade: Trade,
  piece: { qty: number; exitPrice: number; reason: string; closeOrderId: string },
): Promise<Trade> {
  const share = piece.qty / trade.qty
  const { id: _id, ...rest } = trade
  const [closed] = await deps.db
    .insert(trades)
    .values({
      ...rest,
      qty: piece.qty,
      notional: trade.notional * share,
      status: 'closed',
      exitReason: piece.reason,
      closeOrderId: piece.closeOrderId,
      exitPrice: piece.exitPrice,
      closedAt: nowIso(),
    })
    .returning()
  if (closed === undefined) {
    throw new StateError(`could not record the partial sale of trade ${trade.id}`)
  }
  await deps.db
    .update(trades)
    .set({ qty: trade.qty - piece.qty, notional: trade.notional - trade.notional * share })
    .where(eq(trades.id, trade.id))
  await settleTrade(deps.db, closed)
  await enqueuePost(deps, { tradeId: closed.id, kind: 'sell' })
  return closed
}

async function closePart(
  deps: TradeDeps,
  trade: Trade,
  exit: Exit,
  fraction: number,
): Promise<Trade> {
  const qty = partQty(trade, fraction)
  const order = await sellLot(deps, { ...trade, qty }, exit, true)
  const filled = await deps.alpaca.waitForFill(order.id, order)
  return recordPiece(deps, trade, {
    qty,
    exitPrice: filled.filled_avg_price ?? trade.entryPrice,
    reason: exit.reason,
    closeOrderId: order.id,
  })
}

const assertSellable = (trade: Trade, exit: Exit): void => {
  assertCanClose(trade.symbol, trade.openedAt, exit.account, new Date())
  if (!canExitNow(trade, exit.marketOpen)) {
    throw new StateError(
      `${trade.symbol} can only be sold in the regular session (fractional shares and options do not trade after hours)`,
    )
  }
}

export async function closeTrade(
  deps: TradeDeps,
  trade: Trade,
  exit: Exit,
  fraction?: number,
): Promise<Trade> {
  assertSellable(trade, exit)
  if (fraction !== undefined) {
    return closePart(deps, trade, exit, fraction)
  }
  await setStatus(deps.db, trade.id, 'open', { status: 'closing', exitReason: exit.reason })
  let order: Order
  try {
    order = await sellLot(deps, trade, exit, false)
  } catch (error) {
    await setStatus(deps.db, trade.id, 'closing', { status: 'open', exitReason: null })
    throw error
  }
  await deps.db.update(trades).set({ closeOrderId: order.id }).where(eq(trades.id, trade.id))
  const filled = await deps.alpaca.waitForFill(order.id, order)
  return finalize(deps, trade.id, filled.filled_avg_price ?? trade.entryPrice)
}

async function sellLot(
  deps: TradeDeps,
  trade: Trade,
  exit: Exit,
  partial: boolean,
): Promise<Order> {
  if (!exit.marketOpen && !isCrypto(trade.symbol)) {
    const floor = Math.floor(exit.price * EXTENDED_SELL_BUFFER * CENTS_SCALE) / CENTS_SCALE
    return deps.alpaca.sell(trade.symbol, trade.qty, floor)
  }
  if (partial) {
    return deps.alpaca.sell(trade.symbol, trade.qty, null)
  }
  const [other] = await deps.db
    .select({ id: trades.id })
    .from(trades)
    .where(
      and(
        eq(trades.symbol, trade.symbol),
        inArray(trades.status, ['open', 'closing']),
        ne(trades.id, trade.id),
      ),
    )
    .limit(1)
  return other === undefined
    ? deps.alpaca.closePosition(trade.symbol)
    : deps.alpaca.sell(trade.symbol, trade.qty, null)
}

export async function finalize(deps: TradeDeps, id: number, exitPrice: number): Promise<Trade> {
  const closed = await setStatus(deps.db, id, 'closing', {
    status: 'closed',
    exitPrice,
    closedAt: nowIso(),
  })
  await settleTrade(deps.db, closed)
  await enqueuePost(deps, { tradeId: closed.id, kind: 'sell' })
  return closed
}

export async function setStatus(
  db: Db,
  id: number,
  from: Trade['status'],
  patch: Partial<Trade>,
): Promise<Trade> {
  const [row] = await db
    .update(trades)
    .set(patch)
    .where(and(eq(trades.id, id), eq(trades.status, from)))
    .returning()
  if (row === undefined) {
    throw new StateError(`trade ${id} is no longer ${from}`)
  }
  return row
}

async function enqueuePost(deps: TradeDeps, job: PostJob): Promise<void> {
  try {
    await deps.postQueue.send(job)
  } catch (error) {
    log.error({ message: 'post enqueue failed', job, error: errorMessage(error) })
  }
}

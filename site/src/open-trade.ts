import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { type Account, type Order } from './alpaca'
import { contractMultiplier, isOption, isWholeShares, type BuyOrder } from './symbols'
import type { Db } from './db/client'
import { trades, type Trade, type Fund } from './db/schema'
import { StateError } from './errors'
import { requireActiveFund } from './funds'
import { assertExitsBracketPrice, assertSizing, assertTradable, GuardrailError } from './guardrails'
import { deployableUsd } from './allocation'
import { liquidating } from './liquidation'
import { nowIso } from './time'
import { activate, activeTrades, lotOf, requirePrice, setStatus, type TradeDeps } from './trades'

const MAX_HORIZON = 40
const MAX_REASON = 150
const MAX_ALIVE_HOURS = 168
const DEFAULT_ALIVE_HOURS = 24
const MS_PER_HOUR = 3_600_000
const isTradableSymbol = (symbol: string): boolean =>
  /^[A-Z.]{1,10}(\/USD)?$/.test(symbol) || isOption(symbol)

const MAX_TRAIL_PCT = 50

const base = {
  fund: z.string().min(1),
  symbol: z.string().trim().toUpperCase().refine(isTradableSymbol, 'symbol like AAPL or BTC/USD'),
  stop: z.number().positive(),
  target: z.number().positive(),
  trailPct: z.number().positive().max(MAX_TRAIL_PCT).optional(),
  horizon: z.string().trim().min(1).max(MAX_HORIZON),
  reason: z.string().trim().min(1).max(MAX_REASON),
}

export const openPositionInput = z.union([
  z.object({
    ...base,
    notional: z.number().positive(),
    qty: z.undefined().optional(),
    limit: z.undefined().optional(),
  }),
  z.object({
    ...base,
    qty: z.number().positive(),
    limit: z.number().positive().optional(),
    aliveHours: z.number().positive().max(MAX_ALIVE_HOURS).optional(),
    notional: z.undefined().optional(),
  }),
])

export type OpenPositionInput = z.infer<typeof openPositionInput>

const buyOrder = (input: OpenPositionInput): BuyOrder =>
  input.qty === undefined
    ? { symbol: input.symbol, notional: input.notional, limit: null }
    : { symbol: input.symbol, qty: input.qty, limit: input.limit ?? null }

const deployedIn = (active: Trade[], fund: string): number =>
  active.filter((t) => t.fund === fund).reduce((sum, t) => sum + t.notional, 0)

type Checked = {
  fund: Fund
  account: Account
  reference: number
  notional: number
  assetClass: Trade['assetClass']
}

async function check(deps: TradeDeps, input: OpenPositionInput, order: BuyOrder): Promise<Checked> {
  const fund = await requireActiveFund(deps.db, input.fund)
  const active = await activeTrades(deps.db)
  if (liquidating(active)) {
    throw new GuardrailError(
      'liquidating',
      'the operator is liquidating the book; no new positions until it is flat',
    )
  }
  const [account, clock, asset, prices] = await Promise.all([
    deps.alpaca.account(),
    deps.alpaca.clock(),
    deps.alpaca.asset(input.symbol),
    deps.alpaca.latestPrices([input.symbol]),
  ])
  const fractional = !isWholeShares(order.qty)
  assertTradable({
    symbol: input.symbol,
    asset,
    marketOpen: clock.is_open,
    activeSymbols: active.filter((t) => t.fund === input.fund).map((t) => t.symbol),
    fractional,
    queuesForOpen: order.limit !== null && !fractional && !isOption(input.symbol),
  })
  const reference = order.limit ?? requirePrice(prices, input.symbol)
  const notional =
    order.qty === undefined
      ? order.notional
      : order.qty * reference * contractMultiplier(input.symbol)
  assertSizing({
    symbol: input.symbol,
    notional,
    account,
    fundName: fund.name,
    fundCap: deployableUsd(fund, new Date()),
    fundDeployed: deployedIn(active, input.fund),
  })
  assertExitsBracketPrice(input.stop, input.target, reference)
  return { fund, account, reference, notional, assetClass: asset.class }
}

export async function openTrade(deps: TradeDeps, input: OpenPositionInput): Promise<Trade> {
  const order = buyOrder(input)
  const checked = await check(deps, input, order)
  const pending = await insertPending(deps.db, input, checked.assetClass, checked)
  const submitted = await submitBuy(deps, pending, order)
  if (order.limit !== null && submitted.status !== 'filled') {
    return { ...pending, orderId: submitted.id }
  }
  const filled =
    submitted.status === 'filled' ? submitted : await deps.alpaca.waitForFill(submitted.id)
  return activate(deps, pending.id, filled)
}

const expiry = (input: OpenPositionInput): string | null =>
  input.limit === undefined
    ? null
    : new Date(Date.now() + (input.aliveHours ?? DEFAULT_ALIVE_HOURS) * MS_PER_HOUR).toISOString()

async function insertPending(
  db: Db,
  input: OpenPositionInput,
  assetClass: Trade['assetClass'],
  sizing: { notional: number; reference: number },
): Promise<Trade> {
  const { fund, symbol, stop, target, horizon, reason } = input
  const [row] = await db
    .insert(trades)
    .values({
      fund,
      symbol,
      stop,
      target,
      trailPct: input.trailPct ?? null,
      horizon,
      reason,
      assetClass,
      notional: sizing.notional,
      qty: input.qty ?? 0,
      limitPrice: input.limit ?? null,
      expiresAt: expiry(input),
      entryPrice: sizing.reference,
      status: 'pending',
      openedAt: nowIso(),
    })
    .returning()
  if (row === undefined) {
    throw new StateError('trade insert returned nothing')
  }
  return row
}

async function submitBuy(deps: TradeDeps, pending: Trade, order: BuyOrder): Promise<Order> {
  try {
    const submitted = await deps.alpaca.buy(order)
    await deps.db.update(trades).set({ orderId: submitted.id }).where(eq(trades.id, pending.id))
    return submitted
  } catch (error) {
    await deps.db.delete(trades).where(eq(trades.id, pending.id))
    throw error
  }
}

export type QueuedTrade = Trade & { orderId: string }

export async function findQueuedTrade(db: Db, symbol: string, fund?: string): Promise<QueuedTrade> {
  const [trade] = await db
    .select()
    .from(trades)
    .where(and(eq(trades.status, 'pending'), ...lotOf(symbol, fund)))
  if (trade?.orderId === undefined || trade.orderId === null) {
    throw new StateError(`no queued order in ${symbol}${fund === undefined ? '' : ` for ${fund}`}`)
  }
  return { ...trade, orderId: trade.orderId }
}

export async function cancelQueued(
  deps: TradeDeps,
  trade: QueuedTrade,
  reason: string,
): Promise<Trade> {
  const order = await deps.alpaca.order(trade.orderId)
  if (order.status === 'filled') {
    await activate(deps, trade.id, order)
    throw new StateError(`${trade.symbol} already filled; it is an open position now`)
  }
  await deps.alpaca.cancelOrder(trade.orderId)
  return setStatus(deps.db, trade.id, 'pending', {
    status: 'cancelled',
    exitReason: reason,
    closedAt: nowIso(),
  })
}

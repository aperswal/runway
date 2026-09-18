import { isOption } from './symbols'
import type { Trade } from './db/schema'
import { StateError } from './errors'
import { MISSING_AT_BROKER } from './reconcile'
import { holdDuration, shortDay } from './time'

const PERCENT = 100
const CENTS = 2
const SMALL_PRICE_DIGITS = 3

const OCC_TAIL = 15
const YEAR_AT = -15
const MONTH_AT = -13
const DAY_AT = -11
const KIND_AT = -9
const STRIKE_AT = -8
const STRIKE_SCALE = 1000

export type OptionParts = {
  root: string
  expiry: string
  kind: 'call' | 'put'
  strike: number
}

export function optionParts(symbol: string): OptionParts | null {
  if (!isOption(symbol)) {
    return null
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  const mm = symbol.slice(MONTH_AT, DAY_AT)
  const month = months[Number(mm) - 1] ?? mm
  return {
    root: symbol.slice(0, -OCC_TAIL),
    expiry: `${month} ${Number(symbol.slice(DAY_AT, KIND_AT))} 20${symbol.slice(YEAR_AT, MONTH_AT)}`,
    kind: symbol.slice(KIND_AT, STRIKE_AT) === 'C' ? 'call' : 'put',
    strike: Number(symbol.slice(STRIKE_AT)) / STRIKE_SCALE,
  }
}

export const ticker = (symbol: string): string =>
  isOption(symbol) ? symbol.slice(0, -OCC_TAIL) : symbol.replace(/\/.*/, '')

export function label(symbol: string): string {
  const parts = optionParts(symbol)
  return parts === null
    ? ticker(symbol)
    : `${parts.root} $${parts.strike} ${parts.kind} ${parts.expiry}`
}

const price = (n: number): string =>
  Math.floor(n) === 0 ? n.toPrecision(SMALL_PRICE_DIGITS) : n.toFixed(CENTS)

const signed = (pct: number): string => `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`

export function buyText(t: Trade): string {
  return `Buying $${label(t.symbol)} because ${sentence(t.reason)} Will sell at $${price(t.stop)} or $${price(t.target)}. Expecting ${t.horizon} to profitability.`
}

export function sellText(t: Trade): string {
  if (t.exitPrice === null || t.exitReason === null || t.closedAt === null) {
    throw new StateError(`trade ${t.id} is not closed`)
  }
  const pct = ((t.exitPrice - t.entryPrice) / t.entryPrice) * PERCENT
  const held = holdDuration(t.openedAt, t.closedAt)
  const bought = `bought ${shortDay(new Date(t.openedAt))} at $${price(t.entryPrice)}`
  return `Sold $${label(t.symbol)} at $${price(t.exitPrice)}, ${signed(pct)} in ${held} (${bought}). ${exitPhrase(t.exitReason)}`
}

function exitPhrase(reason: string): string {
  if (reason === 'stop') {
    return 'Hit stop.'
  }
  if (reason === 'target') {
    return 'Hit target.'
  }
  return sentence(reason)
}

function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

export const isPublishedExit = (t: Trade): boolean =>
  t.qty > 0 && t.exitReason !== MISSING_AT_BROKER && !t.exitReason?.startsWith('order ')

export const postText = (t: Trade, kind: 'buy' | 'sell'): string =>
  kind === 'buy' ? buyText(t) : sellText(t)

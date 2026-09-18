import { contractMultiplier, isCrypto, isOption } from './symbols'
import { escape, pct, signClass, usd } from './html'
import { signedUsd } from './page-sections'
import { label, ticker } from './posts'
import type { Queued, Summary } from './summary'
import { holdDuration, shortDay } from './time'

const PERCENT = 100
const QTY_PLACES = 4

const fundName = (s: Summary, id: string): string => s.funds.find((f) => f.id === id)?.name ?? id

const changePct = (value: number, unrealizedPl: number): number | null => {
  const cost = value - unrealizedPl
  return cost === 0 ? null : (unrealizedPl / cost) * PERCENT
}

const gain = (plUsd: number, change: number | null): string =>
  change === null ? signedUsd(plUsd) : `${signedUsd(plUsd)} (${pct(change)})`

const unitName = (symbol: string, qty: number): string => {
  if (isCrypto(symbol)) {
    return ticker(symbol)
  }
  if (isOption(symbol)) {
    return qty === 1 ? 'contract' : 'contracts'
  }
  return 'shares'
}

export const units = (symbol: string, qty: number): string =>
  `${Number(qty.toFixed(QTY_PLACES))} ${unitName(symbol, qty)}`

const exits = (t: { stop: number; target: number; trailPct?: number | null }): string =>
  `stop ${usd(t.stop)}${(t.trailPct ?? null) === null ? '' : ` (trails ${t.trailPct}%)`} &middot; target ${usd(t.target)}`

const lead = (s: Summary, symbol: string, fund: string): string =>
  `<div class="lead"><div class="ticker">${escape(label(symbol))}</div><div class="sub">${escape(fundName(s, fund))}</div></div>`

export function holdingRows(s: Summary): string {
  if (s.holdings.length === 0) {
    return `<p class="muted num">All cash. ${usd(s.cash)}</p>`
  }
  const rows = s.holdings.map((h) => {
    const change = changePct(h.value, h.unrealizedPl)
    const detail = `<div class="detail num"><div>${units(h.symbol, h.qty)} at ${usd(h.entryPrice)}</div><div>${exits(h)}</div></div>`
    const value = `<div class="value"><div class="amount num">${usd(h.value)}</div><div class="delta num ${signClass(change)}">${gain(h.unrealizedPl, change)}</div></div>`
    const live = `data-symbol="${escape(h.symbol)}" data-qty="${h.qty}" data-entry="${h.entryPrice}" data-mult="${contractMultiplier(h.symbol)}" data-price="${h.currentPrice}"`
    return `<div class="row" ${live}>${lead(s, h.symbol, h.fund)}${detail}${value}</div>`
  })
  return `<div class="rows">${rows.join('')}</div><p class="muted num" style="margin:12px 0 0">Cash ${usd(s.cash)}</p>`
}

const queuedAmount = (q: Queued): string => {
  const limit = q.limitPrice === null ? 'market' : `limit ${usd(q.limitPrice)}`
  const amount = q.qty > 0 ? `${limit} for ${units(q.symbol, q.qty)}` : limit
  return q.expiresAt === null ? amount : `${amount} until ${shortDay(new Date(q.expiresAt))}`
}

export function queuedRows(s: Summary): string {
  if (s.queued.length === 0) {
    return ''
  }
  const rows = s.queued.map(
    (q) =>
      `<div class="row">${lead(s, q.symbol, q.fund)}<div class="detail num"><div>${queuedAmount(q)}</div><div>${exits(q)}</div></div><div class="value"><div class="amount num">${usd(q.notional)}</div><div class="delta num muted">waiting</div></div></div>`,
  )
  return `<section><h2>Queued</h2><div class="rows">${rows.join('')}</div></section>`
}

const exitPhrase = (reason: string | null): string => {
  if (reason === 'stop') {
    return 'Hit stop'
  }
  return reason === 'target' ? 'Hit target' : escape(reason ?? '')
}

function pager(s: Summary): string {
  const { page, pages } = s.closedPage
  if (pages <= 1) {
    return ''
  }
  const link = (n: number, text: string): string =>
    `<a href="/?h=${s.horizon}&closed=${n}">${text}</a>`
  const newer = page > 1 ? link(page - 1, 'Newer') : '<span></span>'
  const older = page < pages ? link(page + 1, 'Older') : '<span></span>'
  return `<div class="pager num">${newer}<span class="muted">Page ${page} of ${pages}</span>${older}</div>`
}

export function closedRows(s: Summary): string {
  if (s.closedTrades.length === 0) {
    return '<p class="muted">Nothing closed yet.</p>'
  }
  const rows = s.closedTrades.map((t) => {
    const exit = t.exitPrice ?? t.entryPrice
    const change = ((exit - t.entryPrice) / t.entryPrice) * PERCENT
    const plUsd = (exit - t.entryPrice) * t.qty
    const closedAt = t.closedAt ?? t.openedAt
    const when = `${shortDay(new Date(t.openedAt))} to ${shortDay(new Date(closedAt))}`
    return `<div class="row"><div class="lead"><div class="ticker">${escape(ticker(t.symbol))}</div><div class="sub">${exitPhrase(t.exitReason)} in ${holdDuration(t.openedAt, closedAt)}</div></div><div class="detail num"><div>${units(t.symbol, t.qty)}, ${usd(t.entryPrice)} to ${usd(exit)}</div><div>${when}</div></div><div class="value"><div class="amount num">${usd(t.qty * exit)}</div><div class="delta num ${signClass(change)}">${gain(plUsd, change)}</div></div></div>`
  })
  return `<div class="rows">${rows.join('')}</div>${pager(s)}`
}

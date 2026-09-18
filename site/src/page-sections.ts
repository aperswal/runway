import { escape, signClass, usd } from './html'
import { PERIOD_DAYS } from './period'
import type { Summary } from './summary'
import { shortDay } from './time'

const PERCENT = 100
const NOTE_PREVIEW = 180
const MS_PER_HOUR = 3_600_000
const HOURS_PER_DAY = 24

export function fundRows(s: Summary): string {
  const rows = s.funds
    .filter((f) => f.status === 'active')
    .map((f) => {
      const idle = f.openCount === 0 && f.metrics.closed === 0
      const value = idle
        ? '<div class="delta num muted">Cash</div>'
        : `<div class="delta num ${signClass(f.metrics.realizedPl + f.unrealizedPl)}">${signedUsd(f.metrics.realizedPl + f.unrealizedPl)}</div>`
      const state = { full: '', half: ' &middot; half allocation', shut: ' &middot; shut' }[f.tier]
      return `<div class="row"><div class="lead"><div class="ticker" style="font-size:15px;font-weight:500">${escape(f.name)}</div><div class="sub num">${usd(f.capitalUsd)} book${state}</div></div>${value}</div>`
    })
  return `<div class="rows">${rows.join('')}</div>`
}

export const signedUsd = (n: number): string => `${n >= 0 ? '+' : '-'}${usd(Math.abs(n))}`

const due = (endsAt: string | null): string =>
  endsAt === null ? `in ${PERIOD_DAYS} days` : `by ${shortDay(new Date(endsAt))}`

const resetLine = (s: Summary): string =>
  s.money.since === null
    ? `Waiting for the first snapshot. ${PERIOD_DAYS}-day periods.`
    : `Reset to ${usd(s.money.since.equity)} on ${shortDay(new Date(s.money.since.at))}. ${PERIOD_DAYS}-day periods.`

export function survivalCard(s: Summary): string {
  const m = s.money.period
  const share = Math.min(1, Math.max(0, m.returnUsd / s.money.subscriptionUsd))
  const days = `${m.daysLeft} day${m.daysLeft === 1 ? '' : 's'} left`
  const line = m.surviving
    ? `Covered. ${signedUsd(m.returnUsd)} against ${usd(s.money.subscriptionUsd)} ${due(m.endsAt)}.`
    : `${usd(Math.max(0, m.returnUsd))} of ${usd(s.money.subscriptionUsd)} needed ${due(m.endsAt)}`
  return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><div style="font-size:14px;font-weight:600">Survival</div><div class="sub num">${days}</div></div><div class="bar"><div style="width:${(share * PERCENT).toFixed(0)}%"></div></div><div class="sub num">${line}</div><div class="sub muted num">${resetLine(s)}</div></div>`
}

export function lastRunNote(s: Summary): string {
  if (s.lastRun === null) {
    return '<h2>Last run</h2><p class="muted">No runs yet.</p>'
  }
  const text = s.lastRun.summary.trim()
  const preview = text.length > NOTE_PREVIEW ? `${text.slice(0, NOTE_PREVIEW).trimEnd()}...` : text
  const ago = relative(s.lastRun.finishedAt, s.generatedAt)
  const full =
    text.length > NOTE_PREVIEW
      ? `<details><summary>Read the full note</summary><p class="note">${escape(text)}</p></details>`
      : ''
  return `<div style="display:flex;justify-content:space-between;align-items:baseline"><h2 style="margin:0">Last run</h2><div class="sub num">${ago}</div></div><p class="note">${escape(preview)}</p>${full}`
}

export function relative(fromIso: string, toIso: string): string {
  const hours = (new Date(toIso).getTime() - new Date(fromIso).getTime()) / MS_PER_HOUR
  if (hours < 1) {
    return 'just now'
  }
  if (hours < HOURS_PER_DAY) {
    return `${Math.floor(hours)}h ago`
  }
  return `${Math.floor(hours / HOURS_PER_DAY)}d ago`
}

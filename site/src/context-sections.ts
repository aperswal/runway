import type { Headline } from './alpaca'
import { symbolsOf } from './analyses'
import type { Job, Monitor, Run } from './db/schema'
import type { Holding, Summary } from './summary'
import type { FundMemory, Research } from './summary-research'

const CENTS = 2
const TIMESTAMP_LENGTH = 16

const usd = (n: number): string => `$${n.toFixed(CENTS)}`
const pct = (n: number | null): string => (n === null ? 'n/a' : `${n.toFixed(CENTS)}%`)
const when = (iso: string): string => iso.slice(0, TIMESTAMP_LENGTH)

const TIER_TEXT = {
  full: 'full allocation',
  half: 'half allocation',
  shut: 'shut, no new positions',
}
const tierText = (t: keyof typeof TIER_TEXT): string => TIER_TEXT[t]

export function fundLines(s: Summary): string {
  const lines = s.funds.map(
    (f) =>
      `${f.id} (${f.name}, ${f.status}): book ${usd(f.capitalUsd)} (high water ${usd(f.highWaterUsd)}, drawdown ${pct(f.drawdownPct)}, ${tierText(f.tier)}${f.rescues > 0 ? `, ${f.rescues} rescue${f.rescues === 1 ? '' : 's'}` : ''}), deployable ${usd(f.capUsd)}, deployed ${usd(f.deployedUsd)}, unrealized ${usd(f.unrealizedPl)}, realized ${usd(f.metrics.realizedPl)}, ${f.openCount} open, ${f.metrics.closed} closed, win rate ${pct(f.metrics.winRate)}, avg return ${pct(f.metrics.avgReturnPct)}. Mandate: ${f.mandate}`,
  )
  return ['## Funds', ...lines].join('\n')
}

const PERCENT = 100
const ONE_PLACE = 1

function progress(h: Holding): string {
  const risk = h.entryPrice - (h.entryStop ?? h.stop)
  const move = h.currentPrice - h.entryPrice
  const r = risk > 0 ? `${(move / risk).toFixed(ONE_PLACE)}R` : 'R n/a'
  const span = h.target - h.entryPrice
  const toTarget = span > 0 ? `${Math.round((move / span) * PERCENT)}% of the way to target` : ''
  return [r, toTarget].filter((t) => t !== '').join(', ')
}

export function positions(s: Summary): string {
  const lines = s.holdings.map(
    (h) =>
      `${h.symbol} [${h.fund}]: qty ${h.qty}, value ${usd(h.value)}, entry ${usd(h.entryPrice)}, now ${usd(h.currentPrice)}, unrealized ${usd(h.unrealizedPl)} (${progress(h)}), stop ${usd(h.stop)}${h.trailPct === null ? '' : ` trailing ${h.trailPct}%`}, target ${usd(h.target)}, horizon ${h.horizon}, opened ${h.openedAt}. Reason: ${h.reason}`,
  )
  return ['## Open positions', ...(lines.length > 0 ? lines : ['None. All cash.'])].join('\n')
}

export function queued(s: Summary): string {
  const lines = s.queued.map(
    (q) =>
      `${q.symbol} [${q.fund}]: ${q.limitPrice === null ? 'market' : `limit ${usd(q.limitPrice)}`}${q.qty > 0 ? ` x ${q.qty}` : ''}, about ${usd(q.notional)}, stop ${usd(q.stop)}, target ${usd(q.target)}, queued ${q.openedAt}${q.expiresAt === null ? '' : `, alive until ${q.expiresAt}`}. Reason: ${q.reason}`,
  )
  return [
    '## Queued orders (not filled yet; cancel_order to withdraw)',
    ...(lines.length > 0 ? lines : ['None.']),
  ].join('\n')
}

export function closed(s: Summary): string {
  const lines = s.closedTrades.map(
    (t) =>
      `${t.symbol} [${t.fund}]: entry ${usd(t.entryPrice)}, exit ${usd(t.exitPrice ?? t.entryPrice)}, closed ${t.closedAt ?? ''}, reason ${t.exitReason ?? ''}`,
  )
  return ['## Recent closed trades', ...(lines.length > 0 ? lines : ['None.'])].join('\n')
}

export function awaitingLessons(trades: Summary['closedTrades']): string {
  const lines = trades.map(
    (t) =>
      `- trade #${t.id} ${t.symbol} [${t.fund}]: ${t.exitReason ?? 'closed'} at ${usd(t.exitPrice ?? t.entryPrice)} from ${usd(t.entryPrice)}`,
  )
  return [
    '## Closed trades awaiting a lesson (record_lesson with the trade id: technical, execution, psyche)',
    ...(lines.length > 0 ? lines : ['- none']),
  ].join('\n')
}

export function previousRuns(recent: Run[]): string {
  const lines = recent.map(
    (r) => `${r.finishedAt} (${r.trigger}): ${r.error === null ? r.summary : `ERROR ${r.error}`}`,
  )
  return [
    '## Your previous runs',
    ...(lines.length > 0 ? lines : ['This is your first run.']),
  ].join('\n')
}

export function monitorLines(open: Monitor[], now: Date): string {
  const lines = open.map((m) => {
    const state = m.status === 'due' || m.eventAt <= now.toISOString() ? 'DUE NOW' : 'armed'
    return `- #${m.id} [${m.fund}] ${m.symbol} ${m.event} at ${when(m.eventAt)} (${state}): ${m.watch}`
  })
  return [
    '## Monitors (resolve_monitor with the outcome once you have acted)',
    ...(lines.length > 0 ? lines : ['- none']),
  ].join('\n')
}

export function research(r: Research): string {
  const title = `## Research memory (${r.noteCount} notes, ${r.observationCount} observations, ${r.analysisCount} analyses, ${r.lessonCount} lessons; each fund reads its own with query_research)`
  return [title, ...r.byFund.map(fundMemory)].join('\n')
}

const MEMORY_ENTRY_CHARS = 700
const BLOB = /PAYLOAD:|[A-Za-z0-9+/=]{160,}/

export const memoryText = (text: string): string | null => {
  if (BLOB.test(text)) {
    return null
  }
  return text.length > MEMORY_ENTRY_CHARS ? `${text.slice(0, MEMORY_ENTRY_CHARS)} ...` : text
}

const kept = (lines: (string | null)[]): string[] => lines.filter((l): l is string => l !== null)

function fundMemory(m: FundMemory): string {
  const notes = kept(
    m.notes.map((n) => {
      const body = memoryText(n.body)
      return body === null ? null : `- ${when(n.createdAt)} ${n.title}: ${body}`
    }),
  )
  const observations = kept(
    m.observations.map((o) => {
      const note = memoryText(o.note)
      return note === null
        ? null
        : `- ${when(o.createdAt)}${o.symbol === null ? '' : ` ${o.symbol}`} ${o.metric}${o.value === null ? '' : ` = ${o.value}`}: ${note} (${o.source})`
    }),
  )
  const analyses = kept(
    m.analyses.map((a) => {
      const body = memoryText(a.body)
      return body === null
        ? null
        : `- ${when(a.createdAt)} [${a.kind}${a.verdict === null ? '' : `, ${a.verdict}`}] ${a.title}${symbolsOf(a).length > 0 ? ` (${symbolsOf(a).join(', ')})` : ''}: ${body}`
    }),
  )
  const lessons = m.lessons.map(
    (l) =>
      `- ${when(l.createdAt)} [${l.kind}${l.tradeId === null ? '' : `, trade #${l.tradeId}`}] ${l.lesson}`,
  )
  return [
    `### ${m.fund}`,
    'Lessons (rules you set for yourself; say which one applies today):',
    ...(lessons.length > 0 ? lessons : ['- none yet']),
    'Notes:',
    ...(notes.length > 0 ? notes : ['- none yet']),
    'Observations:',
    ...(observations.length > 0 ? observations : ['- none yet']),
    'Analyses:',
    ...(analyses.length > 0 ? analyses : ['- none yet']),
  ].join('\n')
}

export function scheduledJobs(active: Job[]): string {
  const lines = active.map(
    (j) =>
      `- #${j.id} [${j.fund}] ${j.name}: every ${j.everyMinutes} min, ${j.remainingRuns} runs left, next ${when(j.nextRunAt)}${j.lastExitCode === null ? '' : `, last exit ${j.lastExitCode}`}`,
  )
  return [
    '## Scheduled jobs (their output lands in your notes)',
    ...(lines.length > 0 ? lines : ['- none']),
  ].join('\n')
}

export function news(headlines: Headline[]): string {
  const lines = headlines.map(
    (n) =>
      `- ${when(n.created_at)} [${n.symbols.length > 0 ? n.symbols.join(',') : 'market'}] ${n.headline}`,
  )
  return ['## Headlines (Alpaca news)', ...lines].join('\n')
}

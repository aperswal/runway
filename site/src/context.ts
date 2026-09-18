import { desc } from 'drizzle-orm'
import type { Account, Clock, Headline } from './alpaca'
import {
  closed,
  fundLines,
  monitorLines,
  news,
  positions,
  previousRuns,
  queued,
  research,
  scheduledJobs,
  awaitingLessons,
} from './context-sections'
import { lessons, runs, type Run } from './db/schema'
import type { Deps } from './deps'
import {
  MAX_DAY_TRADES,
  MAX_POSITION_FRACTION,
  MIN_CRYPTO_NOTIONAL,
  MIN_STOCK_NOTIONAL,
  PDT_EQUITY_FLOOR,
} from './guardrails'
import { listJobs } from './jobs'
import { liquidationNotice } from './liquidation'
import { listMonitors } from './monitors'
import { ticker } from './posts'
import { PERIOD_DAYS } from './period'
import { nextRun, runMode, runPurpose, scheduleText } from './schedule'
import { buildSummary, type Summary } from './summary'
import { researchSummary, type Research } from './summary-research'

const LIQUIDATION_NOTICE =
  '## Operator directive\nThe operator is liquidating the whole book. Every open lot sells at the next session it can trade; opening positions is blocked until the book is flat. Use this run for research, lessons and a plan, not for orders.'

const RECENT_RUNS = 5
const HEADLINES = 10
const CENTS = 2
const PERCENT = 100
const DATE_LENGTH = 10

const usd = (n: number): string => `$${n.toFixed(CENTS)}`
const pct = (n: number | null): string => (n === null ? 'n/a' : `${n.toFixed(CENTS)}%`)

type Parts = {
  account: Account
  clock: Clock
  summary: Summary
  research: Research
  recentRuns: Run[]
  headlines: Headline[]
  trigger: string
}

export type Scope = { trigger?: string; fund?: string }

export async function buildContext(deps: Deps, now: Date, scope: Scope = {}): Promise<string> {
  const trigger = scope.trigger ?? 'manual'
  const { db, alpaca } = deps
  const subscriptionUsd = deps.summary.rates.subscriptionUsd
  const [account, clock, summary, recentRuns] = await Promise.all([
    alpaca.account(),
    alpaca.clock(),
    buildSummary(db, alpaca, deps.summary, { horizon: '1M', closedPage: 1, now }),
    db.select().from(runs).orderBy(desc(runs.finishedAt)).limit(RECENT_RUNS),
  ])
  const heldSymbols = summary.holdings.map((h) => ticker(h.symbol))
  const [general, held] = await Promise.all([
    alpaca.news([], HEADLINES),
    heldSymbols.length > 0 ? alpaca.news(heldSymbols, HEADLINES) : Promise.resolve([]),
  ])
  const [memory, allJobs, allMonitors, reviewed, liquidation] = await Promise.all([
    researchSummary(db, summary.funds, scope.fund),
    listJobs(db),
    listMonitors(db, {}),
    db.select({ tradeId: lessons.tradeId }).from(lessons),
    liquidationNotice(db),
  ])
  const reviewedIds = new Set(reviewed.map((r) => r.tradeId))
  const parts = {
    account,
    clock,
    summary,
    research: memory,
    recentRuns,
    headlines: [...held, ...general],
    trigger,
  }
  const activeJobs = allJobs.filter((j) => j.status === 'active')
  const openMonitors = allMonitors.filter((m) => m.status !== 'done')
  return [
    header(parts, now),
    ...(liquidation ? [LIQUIDATION_NOTICE] : []),
    money(parts, subscriptionUsd),
    fundLines(parts.summary),
    positions(parts.summary),
    queued(parts.summary),
    closed(parts.summary),
    awaitingLessons(parts.summary.closedTrades.filter((t) => !reviewedIds.has(t.id))),
    previousRuns(parts.recentRuns),
    monitorLines(openMonitors, now),
    research(parts.research),
    scheduledJobs(activeJobs),
    news(parts.headlines),
  ].join('\n\n')
}

function header(p: Parts, now: Date): string {
  const market = p.clock.is_open ? 'OPEN' : 'CLOSED'
  const next = nextRun(now)
  return [
    `Time: ${now.toISOString()} (UTC). US stock market ${market}; next open ${p.clock.next_open}, next close ${p.clock.next_close}.`,
    `Your schedule: ${scheduleText()} ${runPurpose(runMode(p.trigger), p.trigger)} This run ends when you finish your report; you are off until the next run at ${next.at.toISOString()} (a ${next.mode === 'research' ? 'research' : 'trading'} run). Between runs the venue fills queued limit orders, enforces stops and targets every 15 minutes, and runs your scheduled jobs. Queue limit orders and set monitors for anything that must happen while you are off.`,
  ].join('\n')
}

const day = (iso: string): string => iso.slice(0, DATE_LENGTH)

const timeline = (since: Summary['money']['since']): string =>
  since === null
    ? `The ledger starts with the first snapshot; each period lasts ${PERIOD_DAYS} days from there.`
    : `The account and every fund book were set to ${usd(since.equity)} on ${day(since.at)} and the ledger starts there; anything dated earlier predates that reset. Periods last ${PERIOD_DAYS} days.`

function periodLine(m: Summary['money']['period'], subscriptionUsd: number): string {
  const needed = usd(Math.max(0, subscriptionUsd - m.returnUsd))
  if (m.startedAt === null || m.endsAt === null) {
    return `The first period starts with the first snapshot at the current equity ${usd(m.startEquity)}. Shutdown threshold: return under ${usd(subscriptionUsd)} by period end. ${PERIOD_DAYS} days. Still needed: ${needed}.`
  }
  return `Period started ${day(m.startedAt)} at ${usd(m.startEquity)} and ends ${day(m.endsAt)}. Return so far ${usd(m.returnUsd)}. Shutdown threshold: return under ${usd(subscriptionUsd)} by period end. ${m.daysLeft} of ${PERIOD_DAYS} days left. Still needed: ${needed}.`
}

function money(p: Parts, subscriptionUsd: number): string {
  const m = p.summary.money.period
  const c = m.costs
  const pay = p.summary.money.payouts
  const all = p.summary.money.allTime
  return [
    '## Money',
    `Equity ${usd(p.account.equity)}. Cash ${usd(p.account.cash)}.`,
    timeline(p.summary.money.since),
    `Runway is funded by profit only: all-time return ${usd(all.returnUsd)} minus all-time costs ${usd(all.costsUsd)} = ${usd(all.netUsd)}, which covers ${p.summary.money.runwayMonths.toFixed(CENTS)} months at ${usd(p.summary.money.monthlyCostUsd)}/month.`,
    periodLine(m, subscriptionUsd),
    `Full system costs so far this period: ${usd(c.totalUsd)} (Claude subscription ${usd(c.subscriptionUsd)}, Cloudflare ${usd(c.platformUsd)}, X posts ${usd(c.xPostsUsd)}). API-equivalent token spend ${usd(c.apiEquivalentUsd)}. Net after costs ${usd(m.netUsd)}.`,
    `Payout rule: at period end ${(pay.fraction * PERCENT).toFixed(0)}% of profit after costs is paid out to the operator. Paid out so far ${usd(pay.totalUsd)}; capital after payouts ${usd(pay.capitalAfterPayoutsUsd)}.`,
    `Stock day trades used: ${p.account.daytrade_count} of ${MAX_DAY_TRADES} per 5 days (equity under ${usd(PDT_EQUITY_FLOOR)}). Pattern day trader flag: ${String(p.account.pattern_day_trader)}.`,
    `Max per position: ${MAX_POSITION_FRACTION * PERCENT}% of equity = ${usd(p.account.equity * MAX_POSITION_FRACTION)}. Minimum order: $${MIN_STOCK_NOTIONAL} stocks, $${MIN_CRYPTO_NOTIONAL} crypto.`,
    `Performance: ${p.summary.horizons.map((h) => `${h.label} ${pct(h.pct)}`).join(' | ')}`,
  ].join('\n')
}

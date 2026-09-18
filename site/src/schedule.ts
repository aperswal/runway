export const SNAPSHOT_CRON = '*/15 * * * *'
export const MONTH_CLOSE_CRON = '5 5 1 * *'
export const TRADE_CRONS = [
  '30 12 * * 1-5',
  '50 13 * * 1-5',
  '30 16 * * 1-5',
  '40 19 * * 1-5',
  '0 21 * * 1-5',
] as const
export const RESEARCH_CRONS = [
  '0 0 * * *',
  '0 2 * * *',
  '0 4 * * *',
  '0 6 * * *',
  '0 8 * * *',
] as const
export const AGENT_CRONS = [...TRADE_CRONS, ...RESEARCH_CRONS] as const

export type RunMode = 'trade' | 'research'

export const runMode = (trigger: string): RunMode =>
  trigger === 'research' || RESEARCH_CRONS.some((cron) => cron === trigger) ? 'research' : 'trade'

const SUNDAY = 0
const MONDAY = 1
const FRIDAY = 5
const SATURDAY = 6
const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i)
const WEEKDAYS = range(MONDAY, FRIDAY)
const EVERY_DAY = range(SUNDAY, SATURDAY)

type Slot = { minute: number; hour: number; days: number[]; mode: RunMode }

function parse(cron: string): Slot {
  const [minute, hour, , , dow] = cron.split(' ')
  return {
    minute: Number(minute),
    hour: Number(hour),
    days: dow === '1-5' ? WEEKDAYS : EVERY_DAY,
    mode: runMode(cron),
  }
}

const SLOTS = AGENT_CRONS.map(parse)

function nextSlot(slot: Slot, now: Date): Date {
  const at = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), slot.hour, slot.minute),
  )
  while (at.getTime() <= now.getTime() || !slot.days.includes(at.getUTCDay())) {
    at.setUTCDate(at.getUTCDate() + 1)
  }
  return at
}

export function nextRun(now: Date): { at: Date; mode: RunMode } {
  const upcoming = SLOTS.map((slot) => ({ at: nextSlot(slot, now), mode: slot.mode }))
  return upcoming.reduce((soonest, run) => (run.at < soonest.at ? run : soonest))
}

export const scheduleText = (): string =>
  'Trading runs on weekdays at 08:30 New York (an hour before the open), 09:50 (20 minutes after the open), 12:30 (lunch), 15:40 (20 minutes before the close) and 17:00 (an hour after the close). Research runs every night at 20:00, 22:00, 00:00, 02:00 and 04:00 New York. Cron times are UTC (trading 12:30, 13:50, 16:30, 19:40, 21:00; research 00:00, 02:00, 04:00, 06:00, 08:00) and do not shift with daylight saving.'

const RESEARCH_PREFACE =
  'This is a research run. The stock market is closed (crypto trades around the clock and whole-share limit orders can be queued for the next session). Scope is your mandate across the whole market, not only what you hold: new names, other sectors, non-US markets and crypto where your mandate reaches, and the structures around your book. Trades are optional and must rest on an analysis you recorded. Record each piece of work with record_analysis so it appears on the public stats page.'

const RESEARCH_THEMES: Record<string, string> = {
  '0 0 * * *':
    'Tonight: attack your book. For every holding write the strongest bear case, check what today changed, ask "and then what" three times on each open thesis, and reset stops and targets from the evidence, never from need.',
  '0 2 * * *':
    'Tonight: widen the net. Run screeners over all US listings and the non-US markets and crypto your mandate reaches, read the primary sources of the top candidates, and record what you found and what you rejected and why.',
  '0 4 * * *':
    'Tonight: one deep dive. Pick the question inside your mandate whose answer you can least predict, build the question tree, research it until new sources stop changing the answer, and record the conclusion with its premises.',
  '0 6 * * *':
    'Tonight: quant work. Out-of-sample backtests, Monte Carlo simulations of position sizing and exit odds, indicator interplay and regime checks; record every figure.',
  '0 8 * * *':
    'Tonight: the pre-open plan. Due monitors, the event calendar for the next two sessions (earnings, FDA decisions, macro prints), what would change your mind today, and the orders and stops you want in place before the open.',
}

const TRADE_PURPOSE =
  'This is a trading run. Act on the research you already recorded: check your monitors and queued orders, then place the orders your notes and analyses give you a reason and a shaped payoff for; you place them yourself.'

export function runPurpose(mode: RunMode, trigger = 'manual'): string {
  if (mode !== 'research') {
    return TRADE_PURPOSE
  }
  const theme = RESEARCH_THEMES[trigger]
  return theme === undefined ? RESEARCH_PREFACE : `${RESEARCH_PREFACE} ${theme}`
}

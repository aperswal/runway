import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import {
  AGENT_CRONS,
  MONTH_CLOSE_CRON,
  RESEARCH_CRONS,
  SNAPSHOT_CRON,
  TRADE_CRONS,
  nextRun,
  runMode,
  runPurpose,
  scheduleText,
} from './schedule'

describe('schedule', () => {
  it('matches the crons deployed in wrangler.jsonc', () => {
    const deployed = (env as unknown as { TEST_CRONS: string[] }).TEST_CRONS
    expect(deployed.sort()).toEqual([SNAPSHOT_CRON, MONTH_CLOSE_CRON, ...AGENT_CRONS].sort())
    expect(AGENT_CRONS).toEqual([...TRADE_CRONS, ...RESEARCH_CRONS])
  })

  it('tells trading runs from research runs by their trigger', () => {
    expect(TRADE_CRONS.map(runMode)).toEqual(['trade', 'trade', 'trade', 'trade', 'trade'])
    expect(RESEARCH_CRONS.map(runMode)).toEqual([
      'research',
      'research',
      'research',
      'research',
      'research',
    ])
    expect(runMode('manual')).toBe('trade')
    expect(runMode('research')).toBe('research')
    expect(runPurpose('research')).toContain('This is a research run.')
    expect(runPurpose('research')).not.toContain('Tonight:')
    expect(runPurpose('research', '0 0 * * *')).toContain('Tonight: attack your book.')
    expect(runPurpose('research', '0 2 * * *')).toContain('Tonight: widen the net.')
    expect(runPurpose('research', '0 4 * * *')).toContain('Tonight: one deep dive.')
    expect(runPurpose('research', '0 6 * * *')).toContain('Tonight: quant work.')
    expect(runPurpose('research', '0 8 * * *')).toContain('Tonight: the pre-open plan.')
    expect(runPurpose('trade', '30 12 * * 1-5')).toContain('This is a trading run.')
  })

  it('finds the next run across weekdays, weekends and the nightly research runs', () => {
    const next = (iso: string): string => {
      const run = nextRun(new Date(iso))
      return `${run.at.toISOString()} ${run.mode}`
    }
    expect(next('2026-09-15T12:00:00.000Z')).toBe('2026-09-15T12:30:00.000Z trade')
    expect(next('2026-09-15T12:30:00.000Z')).toBe('2026-09-15T13:50:00.000Z trade')
    expect(next('2026-09-15T13:50:00.000Z')).toBe('2026-09-15T16:30:00.000Z trade')
    expect(next('2026-09-15T16:30:00.000Z')).toBe('2026-09-15T19:40:00.000Z trade')
    expect(next('2026-09-15T19:40:00.000Z')).toBe('2026-09-15T21:00:00.000Z trade')
    expect(next('2026-09-15T21:00:00.000Z')).toBe('2026-09-16T00:00:00.000Z research')
    expect(next('2026-09-16T00:00:00.000Z')).toBe('2026-09-16T02:00:00.000Z research')
    expect(next('2026-09-16T06:00:00.000Z')).toBe('2026-09-16T08:00:00.000Z research')
    expect(next('2026-09-16T08:00:00.000Z')).toBe('2026-09-16T12:30:00.000Z trade')
    expect(next('2026-09-19T08:00:00.000Z')).toBe('2026-09-20T00:00:00.000Z research')
    expect(next('2026-09-20T08:00:00.000Z')).toBe('2026-09-21T00:00:00.000Z research')
    expect(next('2026-09-21T08:00:00.000Z')).toBe('2026-09-21T12:30:00.000Z trade')
    expect(next('2026-09-19T05:59:59.999Z')).toBe('2026-09-19T06:00:00.000Z research')
    expect(scheduleText()).toContain('09:50 (20 minutes after the open)')
    expect(scheduleText()).toContain(
      'Research runs every night at 20:00, 22:00, 00:00, 02:00 and 04:00 New York',
    )
    expect(scheduleText()).toContain(
      'Cron times are UTC (trading 12:30, 13:50, 16:30, 19:40, 21:00; research 00:00, 02:00, 04:00, 06:00, 08:00)',
    )
  })
})

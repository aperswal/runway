import { describe, expect, it } from 'vitest'
import { easternDay, holdDuration, minutesBetween, nowIso, shortDay } from './time'

describe('time', () => {
  const lateUtc = new Date('2026-09-02T02:30:00Z')

  it('renders the eastern calendar day', () => {
    expect(easternDay(lateUtc)).toBe('2026-09-01')
    expect(shortDay(lateUtc)).toBe('Sep 1')
  })

  it('produces an iso timestamp for now', () => {
    const before = Date.now()
    const iso = nowIso()
    expect(new Date(iso).getTime()).toBeGreaterThanOrEqual(before)
    expect(iso).toMatch(/Z$/)
  })

  it('measures minutes between', () => {
    expect(minutesBetween('2026-09-01T12:00:00Z', new Date('2026-09-01T12:07:30Z'))).toBe(7.5)
  })

  it('describes hold duration in minutes, hours and days', () => {
    const start = '2026-09-01T12:00:00.000Z'
    expect(holdDuration(start, '2026-09-01T12:00:10.000Z')).toBe('1 minute')
    expect(holdDuration(start, '2026-09-01T12:25:00.000Z')).toBe('25 minutes')
    expect(holdDuration(start, '2026-09-01T12:59:59.000Z')).toBe('60 minutes')
    expect(holdDuration(start, '2026-09-01T13:00:00.000Z')).toBe('1 hour')
    expect(holdDuration(start, '2026-09-01T13:05:00.000Z')).toBe('1 hour')
    expect(holdDuration(start, '2026-09-03T11:59:59.000Z')).toBe('48 hours')
    expect(holdDuration(start, '2026-09-03T12:00:00.000Z')).toBe('2 days')
    expect(holdDuration(start, '2026-09-02T12:00:00.000Z')).toBe('24 hours')
    expect(holdDuration(start, '2026-09-03T13:00:00.000Z')).toBe('2 days')
  })
})

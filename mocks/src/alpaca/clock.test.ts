import { describe, expect, it } from 'vitest'
import { easternParts, isMarketOpen, marketClock } from './clock.ts'

const TUESDAY_MIDDAY = new Date('2026-09-01T15:00:00.000Z')
const TUESDAY_EARLY = new Date('2026-09-01T12:00:00.000Z')
const TUESDAY_BEFORE_OPEN = new Date('2026-09-01T13:29:00.000Z')
const TUESDAY_OPEN = new Date('2026-09-01T13:30:00.000Z')
const TUESDAY_BEFORE_CLOSE = new Date('2026-09-01T19:59:00.000Z')
const TUESDAY_CLOSE = new Date('2026-09-01T20:00:00.000Z')
const WEDNESDAY_LATE = new Date('2026-09-02T21:00:00.000Z')
const THURSDAY_MIDDAY = new Date('2026-09-03T15:00:00.000Z')
const THURSDAY_LATE = new Date('2026-09-03T21:00:00.000Z')
const FRIDAY_MIDDAY = new Date('2026-09-04T15:00:00.000Z')
const FRIDAY_LATE = new Date('2026-09-04T21:00:00.000Z')
const SATURDAY = new Date('2026-09-05T15:00:00.000Z')
const JANUARY = new Date('2026-01-13T15:00:00.000Z')

describe('easternParts', () => {
  it('converts to New York time with the daylight offset', () => {
    expect(easternParts(TUESDAY_MIDDAY)).toEqual({
      weekday: 'Tue',
      year: '2026',
      month: '09',
      day: '01',
      minuteOfDay: 11 * 60,
      offset: '-04:00',
    })
    expect(easternParts(TUESDAY_OPEN).minuteOfDay).toBe(9 * 60 + 30)
  })

  it('uses the standard offset in winter', () => {
    expect(easternParts(JANUARY)).toEqual({
      weekday: 'Tue',
      year: '2026',
      month: '01',
      day: '13',
      minuteOfDay: 10 * 60,
      offset: '-05:00',
    })
  })
})

describe('isMarketOpen', () => {
  it('is open on weekdays from 9:30 until 16:00 New York time', () => {
    expect(isMarketOpen(TUESDAY_EARLY)).toBe(false)
    expect(isMarketOpen(TUESDAY_BEFORE_OPEN)).toBe(false)
    expect(isMarketOpen(TUESDAY_OPEN)).toBe(true)
    expect(isMarketOpen(TUESDAY_MIDDAY)).toBe(true)
    expect(isMarketOpen(TUESDAY_BEFORE_CLOSE)).toBe(true)
    expect(isMarketOpen(TUESDAY_CLOSE)).toBe(false)
    expect(isMarketOpen(THURSDAY_MIDDAY)).toBe(true)
    expect(isMarketOpen(FRIDAY_MIDDAY)).toBe(true)
    expect(isMarketOpen(FRIDAY_LATE)).toBe(false)
    expect(isMarketOpen(SATURDAY)).toBe(false)
  })
})

describe('marketClock', () => {
  it('reports the current session when open', () => {
    expect(marketClock(TUESDAY_MIDDAY, undefined)).toEqual({
      timestamp: '2026-09-01T15:00:00.000Z',
      is_open: true,
      next_open: '2026-09-02T13:30:00.000Z',
      next_close: '2026-09-01T20:00:00.000Z',
    })
    expect(marketClock(TUESDAY_OPEN, undefined)).toEqual({
      timestamp: '2026-09-01T13:30:00.000Z',
      is_open: true,
      next_open: '2026-09-02T13:30:00.000Z',
      next_close: '2026-09-01T20:00:00.000Z',
    })
  })

  it('points at today when before the open', () => {
    expect(marketClock(TUESDAY_BEFORE_OPEN, undefined)).toEqual({
      timestamp: '2026-09-01T13:29:00.000Z',
      is_open: false,
      next_open: '2026-09-01T13:30:00.000Z',
      next_close: '2026-09-01T20:00:00.000Z',
    })
    const clock = marketClock(TUESDAY_EARLY, undefined)
    expect(clock.is_open).toBe(false)
    expect(clock.next_open).toBe('2026-09-01T13:30:00.000Z')
  })

  it('points at tomorrow after the close', () => {
    expect(marketClock(TUESDAY_CLOSE, undefined)).toEqual({
      timestamp: '2026-09-01T20:00:00.000Z',
      is_open: false,
      next_open: '2026-09-02T13:30:00.000Z',
      next_close: '2026-09-02T20:00:00.000Z',
    })
    expect(marketClock(WEDNESDAY_LATE, undefined).next_open).toBe('2026-09-03T13:30:00.000Z')
    expect(marketClock(THURSDAY_LATE, undefined).next_open).toBe('2026-09-04T13:30:00.000Z')
  })

  it('skips the weekend after the friday close', () => {
    const clock = marketClock(FRIDAY_LATE, undefined)
    expect(clock.next_open).toBe('2026-09-07T13:30:00.000Z')
    expect(clock.next_close).toBe('2026-09-07T20:00:00.000Z')
    expect(marketClock(SATURDAY, undefined).next_open).toBe('2026-09-07T13:30:00.000Z')
  })

  it('uses the standard offset in winter', () => {
    expect(marketClock(JANUARY, undefined)).toEqual({
      timestamp: '2026-01-13T15:00:00.000Z',
      is_open: true,
      next_open: '2026-01-14T14:30:00.000Z',
      next_close: '2026-01-13T21:00:00.000Z',
    })
  })

  it('honors the override in both directions', () => {
    expect(marketClock(SATURDAY, true)).toEqual({
      timestamp: '2026-09-05T15:00:00.000Z',
      is_open: true,
      next_open: '2026-09-07T13:30:00.000Z',
      next_close: '2026-09-05T20:00:00.000Z',
    })
    expect(marketClock(TUESDAY_MIDDAY, false)).toEqual({
      timestamp: '2026-09-01T15:00:00.000Z',
      is_open: false,
      next_open: '2026-09-02T13:30:00.000Z',
      next_close: '2026-09-02T20:00:00.000Z',
    })
  })
})

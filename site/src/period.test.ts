import { describe, expect, it } from 'vitest'
import { endedPeriods, periodEnd, periodOf } from './period'

const anchor = '2026-09-18T15:00:00.000Z'

describe('periodOf', () => {
  it('starts day one with thirty days left and nothing elapsed', () => {
    expect(periodOf(anchor, new Date(anchor))).toEqual({
      index: 0,
      start: anchor,
      end: '2026-10-18T15:00:00.000Z',
      daysLeft: 30,
      elapsed: 0,
    })
  })

  it('counts whole days left up and the elapsed share of the period', () => {
    const p = periodOf(anchor, new Date('2026-10-02T15:00:00.000Z'))
    expect(p).toMatchObject({ index: 0, daysLeft: 16 })
    expect(p.elapsed).toBeCloseTo(14 / 30)
    expect(periodOf(anchor, new Date('2026-10-02T16:00:00.000Z')).daysLeft).toBe(16)
    expect(periodOf(anchor, new Date('2026-10-17T16:00:00.000Z')).daysLeft).toBe(1)
  })

  it('rolls into the next period at the boundary and clamps a clock before the anchor', () => {
    expect(periodOf(anchor, new Date('2026-10-18T15:00:00.000Z'))).toMatchObject({
      index: 1,
      start: '2026-10-18T15:00:00.000Z',
      end: '2026-11-17T15:00:00.000Z',
      daysLeft: 30,
      elapsed: 0,
    })
    expect(periodOf(anchor, new Date('2026-09-10T00:00:00.000Z'))).toMatchObject({
      index: 0,
      elapsed: 0,
      daysLeft: 30,
    })
  })
})

describe('periodEnd and endedPeriods', () => {
  it('adds thirty days', () => {
    expect(periodEnd(anchor)).toBe('2026-10-18T15:00:00.000Z')
  })

  it('lists the start of every period that has fully ended', () => {
    expect(endedPeriods(anchor, new Date('2026-10-18T14:59:59.000Z'))).toEqual([])
    expect(endedPeriods(anchor, new Date('2026-10-18T15:00:00.000Z'))).toEqual([anchor])
    expect(endedPeriods(anchor, new Date('2026-12-01T00:00:00.000Z'))).toEqual([
      anchor,
      '2026-10-18T15:00:00.000Z',
    ])
    expect(endedPeriods(anchor, new Date('2026-09-01T00:00:00.000Z'))).toEqual([])
  })
})

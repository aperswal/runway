import { describe, expect, it } from 'vitest'
import { barRange, dailyBars, isWeekdayBar } from './bars.ts'

const NOW = new Date('2026-09-01T15:00:00.000Z')

describe('barRange', () => {
  it('defaults to the last 30 days', () => {
    const range = barRange(new URLSearchParams(), NOW)
    expect(range.end).toBe(NOW)
    expect(range.start.toISOString()).toBe('2026-08-02T15:00:00.000Z')
    expect(range.limit).toBe(1000)
  })

  it('parses explicit bounds and clamps the limit', () => {
    const query = new URLSearchParams({ start: '2026-01-01', end: '2026-01-10', limit: '5' })
    const range = barRange(query, NOW)
    expect(range.start.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-01-10T00:00:00.000Z')
    expect(range.limit).toBe(5)
    expect(barRange(new URLSearchParams({ limit: '99999' }), NOW).limit).toBe(10000)
    expect(barRange(new URLSearchParams({ limit: '10000' }), NOW).limit).toBe(10000)
    expect(barRange(new URLSearchParams({ limit: '0' }), NOW).limit).toBe(1000)
    expect(barRange(new URLSearchParams({ limit: '-1' }), NOW).limit).toBe(1000)
    expect(barRange(new URLSearchParams({ limit: 'x' }), NOW).limit).toBe(1000)
  })

  it('ignores unparseable dates', () => {
    const range = barRange(new URLSearchParams({ start: 'nope', end: 'nope' }), NOW)
    expect(range.end).toBe(NOW)
    expect(range.start.toISOString()).toBe('2026-08-02T15:00:00.000Z')
  })
})

describe('dailyBars', () => {
  const range = {
    start: new Date('2026-08-24T00:00:00.000Z'),
    end: new Date('2026-08-30T00:00:00.000Z'),
    limit: 100,
  }

  it('walks a seeded random path from the base price', () => {
    expect(dailyBars('AAPL', range)).toEqual([
      {
        t: '2026-08-24T00:00:00.000Z',
        o: 875,
        h: 875.19,
        l: 859.36,
        c: 864.46,
        v: 479033,
        n: 4790,
        vw: 868.5,
      },
      {
        t: '2026-08-25T00:00:00.000Z',
        o: 864.46,
        h: 879.19,
        l: 848.88,
        c: 856.13,
        v: 786650,
        n: 7866,
        vw: 862.17,
      },
      {
        t: '2026-08-26T00:00:00.000Z',
        o: 856.13,
        h: 872.02,
        l: 853.3,
        c: 855.27,
        v: 964821,
        n: 9648,
        vw: 859.18,
      },
      {
        t: '2026-08-27T00:00:00.000Z',
        o: 855.27,
        h: 865.52,
        l: 846.48,
        c: 851.25,
        v: 153133,
        n: 1531,
        vw: 854.63,
      },
      {
        t: '2026-08-28T00:00:00.000Z',
        o: 851.25,
        h: 872.12,
        l: 839.37,
        c: 864.3,
        v: 241917,
        n: 2419,
        vw: 856.76,
      },
      {
        t: '2026-08-29T00:00:00.000Z',
        o: 864.3,
        h: 885.1,
        l: 864.27,
        c: 870.43,
        v: 647625,
        n: 6476,
        vw: 871.03,
      },
      {
        t: '2026-08-30T00:00:00.000Z',
        o: 870.43,
        h: 889.21,
        l: 866.59,
        c: 871.92,
        v: 428006,
        n: 4280,
        vw: 874.54,
      },
    ])
  })

  it('differs per symbol and starts from midnight of the start day', () => {
    expect(dailyBars('AAPL', range)).not.toEqual(dailyBars('MSFT', range))
    const offset = { ...range, start: new Date('2026-08-24T18:00:00.000Z') }
    expect(dailyBars('AAPL', offset)).toEqual(dailyBars('AAPL', range))
  })

  it('identifies weekday bars', () => {
    const bars = dailyBars('AAPL', range)
    expect(bars.filter(isWeekdayBar).map((bar) => bar.t.slice(0, 10))).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
    ])
  })
})

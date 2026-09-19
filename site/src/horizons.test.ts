import { beforeEach, describe, expect, it } from 'vitest'
import { db, insertSnapshot, resetDb, stubDb } from '../test/helpers'
import {
  baselineEquity,
  bucketLength,
  cutoff,
  frameSeries,
  loadSeries,
  percentChange,
} from './horizons'

const now = new Date('2026-09-10T12:00:00Z')

describe('horizons', () => {
  it('computes percent change', () => expect(percentChange(200, 210)).toBeCloseTo(5))
  it('returns null without a baseline', () => expect(percentChange(undefined, 210)).toBeNull())
  it('returns null without a latest value', () => expect(percentChange(200, undefined)).toBeNull())
  it('returns null for a zero baseline', () => expect(percentChange(0, 210)).toBeNull())
  it('cuts one day back for 1D', () =>
    expect(cutoff('1D', new Date('2026-09-02T00:00:00Z'))).toBe('2026-09-01T00:00:00.000Z'))
  it('picks raw, hourly or daily buckets by span', () => {
    expect(bucketLength(0)).toBeNull()
    expect(bucketLength(2)).toBeNull()
    expect(bucketLength(2.5)).toBe(13)
    expect(bucketLength(21)).toBe(13)
    expect(bucketLength(21.5)).toBe(10)
  })
  it('cuts a week, a month and a quarter back', () => {
    expect(cutoff('1W', now)).toBe('2026-09-03T12:00:00.000Z')
    expect(cutoff('1M', now)).toBe('2026-08-11T12:00:00.000Z')
    expect(cutoff('3M', now)).toBe('2026-06-12T12:00:00.000Z')
  })
})

describe('series', () => {
  beforeEach(async () => {
    await resetDb()
    await insertSnapshot({ takenAt: '2026-09-01T12:00:00.000Z', equity: 900 })
    await insertSnapshot({ takenAt: '2026-09-05T12:00:00.000Z', equity: 950 })
    await insertSnapshot({ takenAt: '2026-09-09T13:00:00.000Z', equity: 1000 })
    await insertSnapshot({ takenAt: '2026-09-09T20:00:00.000Z', equity: 1010 })
    await insertSnapshot({ takenAt: '2026-09-10T11:00:00.000Z', equity: 1020 })
  })

  it('returns every point inside a day', async () => {
    expect(await loadSeries(db, '1D', now)).toEqual([
      { takenAt: '2026-09-09T13:00:00.000Z', equity: 1000 },
      { takenAt: '2026-09-09T20:00:00.000Z', equity: 1010 },
      { takenAt: '2026-09-10T11:00:00.000Z', equity: 1020 },
    ])
  })

  it('returns every point inside a week', async () => {
    expect((await loadSeries(db, '1W', now)).map((p) => p.equity)).toEqual([950, 1000, 1010, 1020])
  })

  it('keeps the last point of each hour when the span is under three weeks', async () => {
    await insertSnapshot({ takenAt: '2026-09-09T13:30:00.000Z', equity: 1005 })
    expect(await loadSeries(db, '1M', now)).toEqual([
      { takenAt: '2026-09-01T12:00:00.000Z', equity: 900 },
      { takenAt: '2026-09-05T12:00:00.000Z', equity: 950 },
      { takenAt: '2026-09-09T13:30:00.000Z', equity: 1005 },
      { takenAt: '2026-09-09T20:00:00.000Z', equity: 1010 },
      { takenAt: '2026-09-10T11:00:00.000Z', equity: 1020 },
    ])
  })

  it('keeps the last point of each day for long spans', async () => {
    await insertSnapshot({ takenAt: '2026-08-12T12:00:00.000Z', equity: 800 })
    await insertSnapshot({ takenAt: '2026-08-12T15:00:00.000Z', equity: 810 })
    expect((await loadSeries(db, '1M', now)).map((p) => p.equity)).toEqual([
      810, 900, 950, 1010, 1020,
    ])
    expect((await loadSeries(db, 'ALL', now)).map((p) => p.equity)).toEqual([
      810, 900, 950, 1010, 1020,
    ])
  })

  it('uses no cutoff for ALL and returns raw points for short spans', async () => {
    const all = await loadSeries(db, 'ALL', now)
    expect(all.map((p) => p.equity)).toEqual([900, 950, 1000, 1010, 1020])
    await resetDb()
    await insertSnapshot({ takenAt: '2026-09-10T10:00:00.000Z', equity: 1 })
    await insertSnapshot({ takenAt: '2026-09-10T10:15:00.000Z', equity: 2 })
    expect((await loadSeries(db, 'ALL', now)).map((p) => p.equity)).toEqual([1, 2])
    await resetDb()
    expect(await loadSeries(db, 'ALL', now)).toEqual([])
  })

  it('drops groups without a timestamp', async () => {
    const fake = stubDb([[{ takenAt: '2026-08-01T00:00:00.000Z' }], [{ takenAt: null, equity: 1 }]])
    expect(await loadSeries(fake, 'ALL', now)).toEqual([])
  })

  it('takes the last point before the cutoff as baseline', async () => {
    expect(await baselineEquity(db, '1D', now)).toBe(950)
    expect(await baselineEquity(db, '1W', now)).toBe(900)
  })

  it('falls back to the first point when nothing precedes the cutoff', async () => {
    expect(await baselineEquity(db, '1D', new Date('2026-09-01T00:00:00Z'))).toBe(900)
  })

  it('uses the first point for ALL', async () => {
    expect(await baselineEquity(db, 'ALL', now)).toBe(900)
  })

  it('uses a precomputed first equity instead of querying when given', async () => {
    expect(await baselineEquity(db, 'ALL', now, Promise.resolve(123))).toBe(123)
    expect(
      await baselineEquity(db, '1D', new Date('2026-09-01T00:00:00Z'), Promise.resolve(456)),
    ).toBe(456)
  })

  it('is undefined without snapshots', async () => {
    await resetDb()
    expect(await baselineEquity(db, 'ALL', now)).toBeUndefined()
  })
})

describe('frameSeries', () => {
  const at = new Date('2026-09-19T02:00:00.000Z')
  const frame = { now: at, baseline: 1000, equity: 1010, firstAt: '2026-09-17T04:00:00.000Z' }
  const anchor = { takenAt: '2026-09-17T04:00:00.000Z', equity: 1000 }
  const live = { takenAt: '2026-09-19T02:00:00.000Z', equity: 1010 }

  it('draws a fresh ledger as a line from its anchor to the live equity', () => {
    expect(frameSeries([anchor], { ...frame, horizon: 'ALL' })).toEqual([anchor, live])
    expect(frameSeries([anchor], { ...frame, horizon: '1W' })).toEqual([anchor, live])
  })

  it('starts a window that opens after the last snapshot at its baseline', () => {
    expect(frameSeries([], { ...frame, horizon: '1D' })).toEqual([
      { takenAt: '2026-09-18T02:00:00.000Z', equity: 1000 },
      live,
    ])
    const recent = { takenAt: '2026-09-18T20:00:00.000Z', equity: 1005 }
    expect(frameSeries([recent], { ...frame, horizon: '1D' })).toEqual([
      { takenAt: '2026-09-18T02:00:00.000Z', equity: 1000 },
      recent,
      live,
    ])
  })

  it('adds nothing a series already has and stays empty without a ledger or a live value', () => {
    const edge = { takenAt: '2026-09-18T02:00:00.000Z', equity: 990 }
    expect(frameSeries([edge, live], { ...frame, horizon: '1D' })).toEqual([edge, live])
    expect(frameSeries([], { ...frame, horizon: 'ALL' })).toEqual([])
    expect(frameSeries([], { ...frame, horizon: '1D', baseline: undefined })).toEqual([])
    expect(frameSeries([], { ...frame, horizon: '1D', firstAt: undefined })).toEqual([])
    expect(frameSeries([anchor], { ...frame, horizon: 'ALL', equity: 0 })).toEqual([anchor])
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb, seedFund, stubDb } from '../test/helpers'
import { monitors } from './db/schema'
import { GuardrailError } from './guardrails'
import {
  createMonitor,
  listMonitors,
  markDueMonitors,
  monitorInput,
  monitorQuery,
  resolveInput,
  resolveMonitor,
} from './monitors'

const now = new Date('2026-09-02T12:00:00.000Z')
const input = {
  fund: 'social',
  symbol: 'aapl',
  event: 'earnings',
  eventAt: '2026-10-30T20:30:00.000Z',
  watch: 'guide above $1.2B: hold; miss: close',
}

describe('monitor inputs', () => {
  it('validates and normalizes', () => {
    expect(monitorInput.parse(input)).toEqual({ ...input, symbol: 'AAPL' })
    expect(monitorInput.parse({ ...input, symbol: ' aapl ', event: ' earnings ' })).toMatchObject({
      symbol: 'AAPL',
      event: 'earnings',
    })
    expect(monitorInput.safeParse({ ...input, eventAt: 'tomorrow' }).success).toBe(false)
    expect(monitorInput.safeParse({ ...input, watch: ' ' }).success).toBe(false)
    expect(monitorInput.safeParse({ ...input, event: 'x'.repeat(121) }).success).toBe(false)
    expect(monitorQuery.parse({ status: 'due' })).toEqual({ status: 'due' })
    expect(monitorQuery.safeParse({ status: 'later' }).success).toBe(false)
    expect(resolveInput.parse({ outcome: ' beat ' })).toEqual({ outcome: 'beat' })
  })
})

describe('monitors', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })
  it('arms future events, marks past ones due, lists by fund and status, resolves', async () => {
    const armed = await createMonitor(db, monitorInput.parse(input), now)
    expect(armed).toMatchObject({ symbol: 'AAPL', status: 'armed', createdAt: now.toISOString() })
    const past = await createMonitor(
      db,
      monitorInput.parse({ ...input, symbol: 'MSFT', eventAt: '2026-09-01T00:00:00.000Z' }),
      now,
    )
    expect(past.status).toBe('due')
    const exact = await createMonitor(
      db,
      monitorInput.parse({ ...input, symbol: 'NOW', eventAt: now.toISOString() }),
      now,
    )
    expect(exact.status).toBe('due')
    await resolveMonitor(db, exact.id, 'x')
    await db.insert(monitors).values({
      fund: 'supply',
      symbol: 'FRO',
      event: 'rates',
      eventAt: '2026-09-02T11:00:00.000Z',
      watch: 'w',
      status: 'armed',
      createdAt: now.toISOString(),
    })
    expect((await listMonitors(db, {})).map((m) => m.symbol)).toEqual([
      'MSFT',
      'FRO',
      'NOW',
      'AAPL',
    ])
    expect((await listMonitors(db, { fund: 'social' })).map((m) => m.symbol)).toEqual([
      'MSFT',
      'NOW',
      'AAPL',
    ])
    expect(await markDueMonitors(db, now)).toBe(1)
    expect((await listMonitors(db, { status: 'due' })).map((m) => m.symbol)).toEqual([
      'MSFT',
      'FRO',
    ])
    expect(await markDueMonitors(db, now)).toBe(0)
    const done = await resolveMonitor(db, past.id, 'beat and raised')
    expect(done).toMatchObject({ status: 'done', outcome: 'beat and raised' })
    expect(done.doneAt).toMatch(/Z$/)
    expect((await resolveMonitor(db, armed.id, 'early')).status).toBe('done')
    await expect(resolveMonitor(db, past.id, 'again')).rejects.toThrow(GuardrailError)
    await expect(resolveMonitor(db, 999, 'x')).rejects.toThrow(
      'unknown_monitor: no open monitor 999',
    )
  })
  it('refuses unknown funds, too many armed monitors, and empty inserts', async () => {
    await expect(
      createMonitor(db, monitorInput.parse({ ...input, fund: 'nope' }), now),
    ).rejects.toThrow(GuardrailError)
    const done = { ...monitorInput.parse(input), status: 'done' as const, createdAt: 'x' }
    for (let i = 0; i < 20; i += 1) {
      await db.insert(monitors).values(done)
      await db.insert(monitors).values({ ...done, fund: 'supply', status: 'armed' })
    }
    for (let i = 0; i < 20; i += 1) {
      await createMonitor(db, monitorInput.parse({ ...input, symbol: `S${i}` }), now)
    }
    await expect(createMonitor(db, monitorInput.parse(input), now)).rejects.toThrow(
      'too_many_monitors: social already has 20 armed monitors; resolve one first',
    )
    const fund = { id: 'social', status: 'active' }
    await expect(
      createMonitor(stubDb([[fund], [], []]), monitorInput.parse(input), now),
    ).rejects.toThrow('monitor insert returned nothing')
  })
})

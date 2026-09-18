import { beforeEach, describe, expect, it } from 'vitest'
import { db, insertTrade, resetDb, seedFund, stubDb } from '../test/helpers'
import {
  activeFunds,
  createFund,
  fundInput,
  listFunds,
  reallocateFund,
  requireActiveFund,
  retireFund,
  retireInput,
  shareInput,
} from './funds'
import { GuardrailError } from './guardrails'

const input = {
  id: 'supply',
  name: 'Supply chain',
  mandate: 'Hunt for bottlenecks and trade the beneficiaries.',
  share: 0.4,
}

describe('fund inputs', () => {
  it('requires a slug id', () => {
    const idIssue = (id: string): string | undefined =>
      fundInput.safeParse({ ...input, id }).error?.issues[0]?.message
    expect(idIssue('Bad Id')).toBe('lowercase slug like social-signal')
    expect(idIssue('Xab')).toBeDefined()
    expect(idIssue('ab!')).toBeDefined()
    expect(idIssue('a')).toBeDefined()
    expect(idIssue('a'.repeat(25))).toBeDefined()
    expect(idIssue('a1')).toBeUndefined()
    expect(fundInput.safeParse(input).success).toBe(true)
  })
  it('trims and bounds names and mandates', () => {
    const parsed = fundInput.parse({
      ...input,
      name: '  Supply  ',
      mandate: `  ${input.mandate}  `,
    })
    expect(parsed.name).toBe('Supply')
    expect(parsed.mandate).toBe(input.mandate)
    expect(fundInput.safeParse({ ...input, name: ' ' }).success).toBe(false)
    expect(fundInput.safeParse({ ...input, name: 'n'.repeat(61) }).success).toBe(false)
    expect(fundInput.safeParse({ ...input, mandate: 'too short a mandate' }).success).toBe(false)
    expect(fundInput.safeParse({ ...input, mandate: 'm'.repeat(1501) }).success).toBe(false)
  })
  it('bounds shares', () => {
    expect(shareInput.safeParse({ share: 1.5 }).success).toBe(false)
    expect(shareInput.safeParse({ share: 0.5 }).success).toBe(true)
  })
  it('trims retire reasons', () => {
    expect(retireInput.parse({ reason: '  done  ' })).toEqual({ reason: 'done' })
  })
})

describe('funds', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
    await seedFund({
      id: 'old',
      name: 'Old',
      status: 'retired',
      share: 0.3,
      retiredAt: '2026-08-15T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
  })

  it('lists funds by creation and filters active ones', async () => {
    expect((await listFunds(db)).map((f) => f.id)).toEqual(['old', 'social'])
    expect((await activeFunds(db)).map((f) => f.id)).toEqual(['social'])
  })

  it('requires an active fund', async () => {
    expect((await requireActiveFund(db, 'social')).name).toBe('Social signal')
    await expect(requireActiveFund(db, 'nope')).rejects.toThrow('unknown_fund: no fund nope')
    await expect(requireActiveFund(db, 'old')).rejects.toThrow(
      'fund_retired: old was retired 2026-08-15T00:00:00.000Z',
    )
  })

  it('tolerates a retired fund without a timestamp', async () => {
    await seedFund({ id: 'ghost', status: 'retired' })
    await expect(requireActiveFund(db, 'ghost')).rejects.toThrow(
      /^fund_retired: ghost was retired $/,
    )
  })

  it('creates a fund', async () => {
    const fund = await createFund(db, input, 1000)
    expect(fund).toMatchObject({ ...input, status: 'active', retiredAt: null })
    expect((await activeFunds(db)).map((f) => f.id)).toEqual(['social', 'supply'])
  })

  it('refuses ids that were ever used', async () => {
    await expect(createFund(db, { ...input, id: 'old' }, 1000)).rejects.toThrow(
      'fund_exists: old already exists (retired funds keep their id)',
    )
  })

  it('refuses shares that exceed the free allocation', async () => {
    await expect(createFund(db, { ...input, share: 0.6 }, 1000)).rejects.toThrow(
      'shares_exceeded: only 0.50 of equity is unallocated; retire or shrink a fund first',
    )
  })

  it('reports a create that returned nothing', async () => {
    await expect(createFund(stubDb([[], []]), input, 1000)).rejects.toThrow(
      'fund_exists: supply could not be created',
    )
  })

  it('reallocates within the free share', async () => {
    expect((await reallocateFund(db, 'social', 1, 1000)).share).toBe(1)
    await createFund(db, { ...input, share: 0.0 + 1e-10 }, 1000)
  })

  it('tolerates float noise up to the epsilon', async () => {
    expect((await reallocateFund(db, 'social', 1 + 1e-9, 1000)).share).toBe(1 + 1e-9)
    await expect(reallocateFund(db, 'social', 1 + 2e-9, 1000)).rejects.toThrow('shares_exceeded')
  })

  it('refuses reallocations that overflow', async () => {
    await createFund(db, input, 1000)
    await expect(reallocateFund(db, 'social', 0.7, 1000)).rejects.toThrow(GuardrailError)
    await expect(reallocateFund(db, 'old', 0.1, 1000)).rejects.toThrow('fund_retired')
  })

  it('reports a reallocation that returned nothing', async () => {
    const fund = await requireActiveFund(db, 'social')
    await expect(reallocateFund(stubDb([[fund], [fund], []]), 'social', 0.5, 1000)).rejects.toThrow(
      'unknown_fund: no fund social',
    )
  })

  it('retires a fund without positions', async () => {
    const fund = await retireFund(db, 'social', 'no edge')
    expect(fund.status).toBe('retired')
    expect(fund.retireReason).toBe('no edge')
    expect(fund.retiredAt).toMatch(/Z$/)
  })

  it('refuses to retire a fund with active positions', async () => {
    await insertTrade({ symbol: 'AAPL' })
    await insertTrade({ symbol: 'BTC/USD', status: 'pending' })
    await expect(retireFund(db, 'social', 'x')).rejects.toThrow(
      'fund_has_positions: social still holds AAPL, BTC/USD; close them first',
    )
  })

  it('reports a retire that returned nothing', async () => {
    const fund = await requireActiveFund(db, 'social')
    await expect(retireFund(stubDb([[fund], [], []]), 'social', 'x')).rejects.toThrow(
      'unknown_fund: no fund social',
    )
  })
})

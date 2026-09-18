import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb, seedFund, stubDb } from '../test/helpers'
import {
  analysisInput,
  analysisQuery,
  countAnalyses,
  listAnalyses,
  recordAnalysis,
  symbolsOf,
} from './analyses'
import { analyses } from './db/schema'
import { GuardrailError } from './guardrails'

const input = {
  fund: 'social',
  kind: 'backtest' as const,
  symbols: ['aapl', 'msft'],
  title: 'SMA 10/50',
  body: 'Crosses on daily bars, 2 years, out of sample last 6 months.',
  figures: { return: 12.4, drawdown: 8.1, note: 'ok' },
  verdict: 'adopt' as const,
}
const all = { limit: 50, offset: 0 }

describe('analysisInput', () => {
  it('uppercases symbols, defaults figures and verdict, and bounds sizes', () => {
    expect(analysisInput.parse(input)).toEqual({ ...input, symbols: ['AAPL', 'MSFT'] })
    const bare = analysisInput.parse({ fund: 'f', kind: 'technical', title: 't', body: 'b' })
    expect(bare).toEqual({
      fund: 'f',
      kind: 'technical',
      symbols: null,
      title: 't',
      body: 'b',
      figures: {},
      verdict: null,
    })
    expect(analysisInput.safeParse({ ...input, kind: 'vibes' }).success).toBe(false)
    expect(analysisInput.safeParse({ ...input, verdict: 'maybe' }).success).toBe(false)
    expect(analysisInput.safeParse({ ...input, title: ' ' }).success).toBe(false)
    expect(analysisInput.safeParse({ ...input, body: 'x'.repeat(4001) }).success).toBe(false)
    expect(analysisInput.safeParse({ ...input, symbols: Array(21).fill('A') }).success).toBe(false)
    const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`f${i}`, i]))
    const tooMany = analysisInput.safeParse({ ...input, figures: many })
    expect(tooMany.error?.issues[0]?.message).toBe('at most 12 figures')
    const twelve = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}`, i]))
    expect(analysisInput.safeParse({ ...input, figures: twelve }).success).toBe(true)
    expect(
      analysisInput.parse({ ...input, symbols: [' aapl '], title: ' t ', body: ' b ' }),
    ).toMatchObject({ symbols: ['AAPL'], title: 't', body: 'b' })
    expect(analysisInput.safeParse({ ...input, figures: { ['x'.repeat(41)]: 1 } }).success).toBe(
      false,
    )
    expect(analysisInput.safeParse({ ...input, figures: { a: 'x'.repeat(41) } }).success).toBe(
      false,
    )
  })
  it('parses the query with defaults', () => {
    expect(analysisQuery.parse({})).toEqual({ limit: 50, offset: 0 })
    expect(analysisQuery.parse({ kind: 'strategy', symbol: 'a', limit: '2', offset: '4' })).toEqual(
      {
        kind: 'strategy',
        symbol: 'a',
        limit: 2,
        offset: 4,
      },
    )
    expect(analysisQuery.safeParse({ kind: 'nope' }).success).toBe(false)
  })
})

describe('analyses', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })
  it('records, lists, filters, pages and counts', async () => {
    const row = await recordAnalysis(db, analysisInput.parse(input))
    expect(row).toMatchObject({ ...input, symbols: 'AAPL,MSFT' })
    expect(symbolsOf(row)).toEqual(['AAPL', 'MSFT'])
    const bare = await recordAnalysis(
      db,
      analysisInput.parse({ fund: 'social', kind: 'technical', title: 'RSI', body: 'b' }),
    )
    expect(bare.symbols).toBeNull()
    expect(symbolsOf(bare)).toEqual([])
    expect(symbolsOf({ ...bare, symbols: '' })).toEqual([])
    expect(symbolsOf({ ...bare, symbols: 'A,,B' })).toEqual(['A', 'B'])
    await db.insert(analyses).values({
      fund: 'supply',
      kind: 'simulation',
      symbols: 'FRO',
      title: 'MC',
      body: 'b',
      figures: {},
      verdict: null,
      createdAt: '2999-01-01T00:00:00.000Z',
    })
    const titles = async (q: Parameters<typeof listAnalyses>[1]): Promise<string[]> =>
      (await listAnalyses(db, q)).map((a) => a.title)
    expect(await titles(all)).toEqual(['MC', 'RSI', 'SMA 10/50'])
    expect(await titles({ ...all, fund: 'social' })).toEqual(['RSI', 'SMA 10/50'])
    expect(await titles({ ...all, kind: 'backtest' })).toEqual(['SMA 10/50'])
    expect(await titles({ ...all, symbol: 'msft' })).toEqual(['SMA 10/50'])
    expect(await titles({ limit: 1, offset: 1 })).toEqual(['RSI'])
    expect(await countAnalyses(db, {})).toBe(3)
    expect(await countAnalyses(db, { fund: 'social', kind: 'technical' })).toBe(1)
    expect(await countAnalyses(stubDb([[]]), {})).toBe(0)
  })
  it('refuses unknown funds and empty inserts', async () => {
    await expect(
      recordAnalysis(db, analysisInput.parse({ ...input, fund: 'nope' })),
    ).rejects.toThrow(GuardrailError)
    const fund = { id: 'social', status: 'active' }
    await expect(recordAnalysis(stubDb([[fund], []]), analysisInput.parse(input))).rejects.toThrow(
      'analysis insert returned nothing',
    )
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { db, resetDb, seedFund } from '../test/helpers'
import { analyses, lessons, monitors, notes, observations, plain } from './db/schema'
import {
  PAGE_SIZE,
  notesPage,
  pageCount,
  parseNotesQuery,
  parseStatsQuery,
  statsPage,
} from './research-pages'

describe('query parsing', () => {
  it('defaults to notes and drops invalid queries', () => {
    expect(parseNotesQuery({})).toEqual({ kind: 'notes', page: 1, view: 'plain' })
    expect(parseNotesQuery({ fund: 'social', kind: 'observations', page: '2' })).toEqual({
      fund: 'social',
      kind: 'observations',
      page: 2,
      view: 'plain',
    })
    expect(parseNotesQuery({ kind: 'nope' })).toEqual({ kind: 'notes', page: 1, view: 'plain' })
    expect(parseNotesQuery({ view: 'agent' })).toMatchObject({ view: 'agent' })
    expect(parseStatsQuery({ kind: 'backtest' })).toEqual({
      kind: 'backtest',
      page: 1,
      view: 'plain',
      section: 'analyses',
    })
    expect(parseStatsQuery({ kind: 'nope' })).toEqual({
      page: 1,
      view: 'plain',
      section: 'analyses',
    })
    expect(pageCount(0, 25)).toBe(1)
    expect(pageCount(25, 25)).toBe(1)
    expect(pageCount(26, 25)).toBe(2)
  })
})

describe('pages', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
    await seedFund({ id: 'quant', name: 'Quant' })
    await db.insert(notes).values([
      { fund: 'social', title: 'Social note', body: 'b', createdAt: '2026-09-05T00:00:00.000Z' },
      { fund: 'quant', title: 'Quant note', body: 'b', createdAt: '2026-09-04T00:00:00.000Z' },
    ])
    await db.insert(observations).values({
      fund: 'quant',
      metric: 'funding',
      source: 's',
      note: 'n',
      createdAt: '2026-09-04T00:00:00.000Z',
    })
    await db.insert(analyses).values({
      fund: 'social',
      kind: 'backtest',
      symbols: null,
      title: 'SMA test',
      body: 'b',
      figures: { return: 4 },
      verdict: 'adopt',
      createdAt: '2026-09-04T00:00:00.000Z',
    })
  })
  it('lists notes for all funds and for one fund', async () => {
    const all = await notesPage(db, {}, 'https://runway.test/notes')
    expect(all).toContain('Social note')
    expect(all).toContain('Quant note')
    expect(all).toContain('All<span class="num">2</span>')
    const quant = await notesPage(db, { fund: 'quant' }, 'https://runway.test/notes')
    expect(quant).toContain('Quant note')
    expect(quant).not.toContain('Social note')
    expect(quant).toContain('Quant<span class="num">1</span>')
    expect(quant).toContain('1 notes, newest first')
    const none = await notesPage(db, { fund: 'ghost' }, 'https://runway.test/notes')
    expect(none).toContain('0 notes, newest first')
    expect(none).toContain('<p class="muted">Nothing here yet.</p>')
  })
  it('switches kinds with their own counts', async () => {
    expect(await notesPage(db, { kind: 'observations' }, 'https://runway.test/notes')).toContain(
      '<div class="title">funding</div>',
    )
  })
  it('pages notes and clamps the page to the last one', async () => {
    await db.insert(notes).values(
      Array.from({ length: PAGE_SIZE }, (_, i) => ({
        fund: 'social',
        title: `n${i}`,
        body: 'b',
        createdAt: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      })),
    )
    const first = await notesPage(db, {}, 'https://runway.test/notes')
    expect(first).toContain('Social note')
    expect(first).not.toContain('>n0<')
    expect(first).toContain('Page 1 of 2')
    const last = await notesPage(db, { page: '9' }, 'https://runway.test/notes')
    expect(last).toContain('>n0<')
    expect(last).toContain('Page 2 of 2')
  })
  it('renders stats from the database', async () => {
    const html = await statsPage(
      db,
      { kind: 'backtest' },
      new Date('2026-09-06T00:00:00.000Z'),
      'https://runway.test/stats',
    )
    expect(html).toContain('<title>Runway stats</title>')
    expect(html).toContain('SMA test')
    expect(
      await statsPage(
        db,
        { section: 'strategies' },
        new Date('2026-09-06T00:00:00.000Z'),
        'https://runway.test/stats',
      ),
    ).toContain('+4.00%')
    expect(
      await statsPage(db, { kind: 'nope' }, new Date(), 'https://runway.test/stats'),
    ).toContain('1 analyses, newest first')
  })
})

describe('plain wording', () => {
  const AT = '2026-09-03T00:00:00.000Z'
  const model = { model: 'm', createdAt: AT }
  beforeEach(async () => {
    await resetDb()
    await seedFund({ id: 'quant', name: 'Quant' })
    const [note] = await db
      .insert(notes)
      .values({ fund: 'quant', title: 'RSI<30', body: 'mkt closed', createdAt: AT })
      .returning()
    const [observation] = await db
      .insert(observations)
      .values({
        fund: 'quant',
        symbol: null,
        source: 's',
        metric: 'rsi',
        note: 'oversold',
        createdAt: AT,
      })
      .returning()
    const [analysis] = await db
      .insert(analyses)
      .values({
        fund: 'quant',
        kind: 'technical',
        title: 'MA cross',
        body: '50d > 200d',
        figures: {},
        createdAt: AT,
      })
      .returning()
    const [monitor] = await db
      .insert(monitors)
      .values({
        fund: 'quant',
        symbol: 'AAPL',
        event: 'earnings',
        eventAt: '2026-09-10T00:00:00.000Z',
        watch: 'gap > 5%',
        status: 'armed',
        createdAt: AT,
      })
      .returning()
    await db.insert(plain).values([
      {
        kind: 'note',
        sourceId: Number(note?.id),
        title: 'RSI under 30',
        body: 'The market was closed.',
        ...model,
      },
      {
        kind: 'observation',
        sourceId: Number(observation?.id),
        title: 'rsi',
        body: 'The stock looks oversold.',
        ...model,
      },
      {
        kind: 'analysis',
        sourceId: Number(analysis?.id),
        title: 'Average crossover',
        body: 'The 50 day average is above the 200 day.',
        ...model,
      },
      {
        kind: 'monitor',
        sourceId: Number(monitor?.id),
        title: 'AAPL earnings',
        body: 'A move of more than 5% after earnings.',
        ...model,
      },
    ])
  })

  it('lists lessons with their kind and trade', async () => {
    await db.insert(lessons).values([
      {
        fund: 'quant',
        kind: 'execution',
        lesson: 'Use limit orders after hours.',
        tradeId: 4,
        createdAt: AT,
      },
      { fund: 'quant', kind: 'psyche', lesson: 'Do not chase.', tradeId: null, createdAt: AT },
    ])
    const page = await notesPage(db, { kind: 'lessons' }, 'https://runway.test/notes')
    expect(page).toContain('<h1>Notes</h1><div class="sub">2 lessons, newest first</div>')
    expect(page).toContain(
      '<div class="title">Order placement</div><div class="meta"><span class="tag">Quant</span><span>trade #4</span>',
    )
    expect(page).toContain('<div class="title">Psyche</div>')
    expect(page).toContain('Use limit orders after hours.')
    await db.insert(plain).values({
      kind: 'lesson',
      sourceId: 1,
      title: 'Order placement',
      body: 'Place limit orders when the market is closed.',
      model: 'm',
      createdAt: AT,
    })
    const [row] = await db.select({ id: lessons.id }).from(lessons).limit(1)
    await db.update(plain).set({ sourceId: Number(row?.id) })
    expect(await notesPage(db, { kind: 'lessons' }, 'https://runway.test/notes')).toContain(
      'Place limit orders when the market is closed.',
    )
    expect(
      await notesPage(db, { kind: 'lessons', view: 'agent' }, 'https://runway.test/notes'),
    ).toContain('Use limit orders after hours.')
  })

  it('shows plain words by default and the agent wording on request', async () => {
    const url = 'https://runway.test/notes'
    const plainNotes = await notesPage(db, {}, url)
    expect(plainNotes).toContain('RSI under 30')
    expect(plainNotes).toContain('The market was closed.')
    expect(plainNotes).not.toContain('mkt closed')
    expect(plainNotes).toContain(
      '<a href="/notes?kind=notes" class="active">Plain words</a><a href="/notes?kind=notes&view=agent" class="">Agent</a>',
    )
    const agentNotes = await notesPage(db, { view: 'agent' }, url)
    expect(agentNotes).toContain('mkt closed')
    expect(agentNotes).not.toContain('The market was closed.')
    expect(await notesPage(db, { kind: 'observations' }, url)).toContain(
      'The stock looks oversold.',
    )
    expect(await notesPage(db, { kind: 'observations', view: 'agent' }, url)).toContain('oversold')
    const now = new Date('2026-09-04T00:00:00.000Z')
    const plainStats = await statsPage(db, {}, now, 'https://runway.test/stats')
    expect(plainStats).toContain('Average crossover')
    expect(plainStats).toContain('The 50 day average is above the 200 day.')
    expect(
      await statsPage(db, { section: 'watching' }, now, 'https://runway.test/stats'),
    ).toContain('A move of more than 5% after earnings.')
    expect(plainStats).toContain(
      '<a href="/stats" class="active">Plain words</a><a href="/stats?view=agent" class="">Agent</a>',
    )
    const agentStats = await statsPage(db, { view: 'agent' }, now, 'https://runway.test/stats')
    expect(agentStats).toContain('50d &gt; 200d')
    expect(
      await statsPage(db, { section: 'watching', view: 'agent' }, now, 'https://runway.test/stats'),
    ).toContain('gap &gt; 5%')
    expect(agentStats).not.toContain('Average crossover')
  })
})

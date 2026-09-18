import { describe, expect, it } from 'vitest'
import type { Fund } from './db/schema'
import { href, notesQuery, pager, renderNotes, type NotesData } from './notes-page'

const fund = (id: string, name: string, status: Fund['status'] = 'active'): Fund => ({
  id,
  name,
  mandate: 'm',
  share: 0.5,
  capital: 0,
  highWater: 0,
  rescues: 0,
  rescuedAt: null,
  status,
  createdAt: '2026-08-01T00:00:00.000Z',
  retiredAt: null,
  retireReason: null,
})

const base: NotesData = {
  url: 'https://runway.test/notes',
  query: { kind: 'notes', page: 1, view: 'plain' },
  funds: [
    { fund: fund('social', 'Social & signal'), n: 2 },
    { fund: fund('quant', 'Quant'), n: 0 },
    { fund: fund('old', 'Old', 'retired'), n: 0 },
  ],
  kindTotals: { notes: 2, observations: 5, lessons: 1 },
  total: 2,
  pages: 1,
  entries: {
    kind: 'notes',
    rows: [
      {
        id: 1,
        fund: 'social',
        title: 'Thesis <b>',
        body: 'line one\nline two',
        createdAt: '2026-09-05T14:32:00.000Z',
      },
      {
        id: 2,
        fund: 'social',
        title: 'Older',
        body: 'word '.repeat(80),
        createdAt: '2026-09-04T19:04:00.000Z',
      },
    ],
  },
}

describe('notesQuery', () => {
  it('accepts the three kinds, defaults to notes and page one', () => {
    expect(notesQuery.parse({})).toEqual({ kind: 'notes', page: 1, view: 'plain' })
    expect(notesQuery.parse({ kind: 'observations', fund: 'x', page: '3' })).toEqual({
      kind: 'observations',
      fund: 'x',
      page: 3,
      view: 'plain',
    })
    expect(notesQuery.safeParse({ kind: 'experiments' }).success).toBe(false)
    expect(notesQuery.safeParse({ page: '0' }).success).toBe(false)
  })
})

describe('href and pager', () => {
  it('builds links that keep the fund and kind and only show pages after one', () => {
    const q = { kind: 'observations' as const, fund: 'social', page: 2, view: 'plain' as const }
    expect(href(q, {})).toBe('/notes?fund=social&kind=observations')
    expect(href(q, { page: 3, view: 'plain' })).toBe('/notes?fund=social&kind=observations&page=3')
    expect(href(q, { fund: undefined })).toBe('/notes?kind=observations')
    expect(href({ ...q, view: 'agent' }, { page: 2 })).toBe(
      '/notes?fund=social&kind=observations&view=agent&page=2',
    )
    expect(pager({ page: 1 }, 1, String)).toBe('')
    expect(pager({ page: 1 }, 2, (p) => `/p${p}`)).toBe(
      '<div class="pager num"><span></span><span class="muted">Page 1 of 2</span><a href="/p2">Older</a></div>',
    )
    expect(pager({ page: 2 }, 2, (p) => `/p${p}`)).toBe(
      '<div class="pager num"><a href="/p1">Newer</a><span class="muted">Page 2 of 2</span><span></span></div>',
    )
  })
})

describe('renderNotes', () => {
  it('renders the sticky bar with kind switch, wording switch and fund pills, then the entries', () => {
    const html = renderNotes(base)
    expect(html).toContain('<title>Runway notes</title>')
    expect(html).toContain('<h1>Notes</h1><div class="sub">2 notes, newest first</div>')
    expect(html).toContain(
      '<div class="fbar"><div class="top"><nav class="seg"><a href="/notes?kind=notes" class="active">Notes<span class="num">2</span></a><a href="/notes?kind=observations" class="">Observations<span class="num">5</span></a><a href="/notes?kind=lessons" class="">Lessons<span class="num">1</span></a></nav><div class="side"><nav class="seg"><a href="/notes?kind=notes" class="active">Plain words</a><a href="/notes?kind=notes&view=agent" class="">Agent</a></nav></div></div>',
    )
    expect(html).toContain(
      '<nav class="pillrow"><a href="/notes?kind=notes" class="active">All<span class="num">2</span></a><a href="/notes?fund=social&kind=notes" class="">Social &amp; signal<span class="num">2</span></a><a href="/notes?fund=quant&kind=notes" class="">Quant<span class="num">0</span></a></nav></div>',
    )
    expect(html).not.toContain('>Old<')
    expect(html).toContain(
      '<div class="entry"><div class="title">Thesis &lt;b&gt;</div><div class="meta"><span class="tag">Social &amp; signal</span><span class="num">2026-09-05 14:32</span></div><div class="body">line one\nline two</div></div>',
    )
    expect(html).toContain(
      '<div class="title">Older</div><div class="meta"><span class="tag">Social &amp; signal</span><span class="num">2026-09-04 19:04</span></div><input type="checkbox" class="more" id="e2"><div class="body clamp">word ',
    )
    expect(html).toContain('<label for="e2">More</label>')
    expect(html).not.toContain('class="pager')
  })
  it('marks the active fund and pages', () => {
    const html = renderNotes({
      ...base,
      query: { fund: 'social', kind: 'notes', page: 2, view: 'plain' },
      pages: 3,
    })
    expect(html).toContain(
      '<a href="/notes?fund=social&kind=notes" class="active">Social &amp; signal',
    )
    expect(html).toContain('<a href="/notes?kind=notes" class="">All<span class="num">2</span></a>')
    expect(html).toContain(
      '<div class="pager num"><a href="/notes?fund=social&kind=notes">Newer</a><span class="muted">Page 2 of 3</span><a href="/notes?fund=social&kind=notes&page=3">Older</a></div>',
    )
  })
  it('renders observations and lessons with their tags, and says when empty', () => {
    const observations = renderNotes({
      ...base,
      query: { kind: 'observations', page: 1, view: 'plain' },
      entries: {
        kind: 'observations',
        rows: [
          {
            id: 1,
            fund: 'quant',
            symbol: 'BTC/USD',
            metric: 'funding',
            value: -0.01,
            source: 'https://x.test',
            note: 'reset <i>',
            createdAt: '2026-09-05T00:00:00.000Z',
          },
          {
            id: 2,
            fund: 'nobody',
            symbol: null,
            metric: 'mood',
            value: null,
            source: 'site',
            note: 'meh',
            createdAt: '2026-09-04T00:00:00.000Z',
          },
        ],
      },
    })
    expect(observations).toContain(
      '<div class="title">BTC/USD funding = -0.01</div><div class="meta"><span class="tag">Quant</span>',
    )
    expect(observations).toContain(
      '<div class="body">reset &lt;i&gt;\n<span class="sub">https://x.test</span></div>',
    )
    expect(observations).toContain(
      '<div class="title">mood</div><div class="meta"><span class="tag">nobody</span>',
    )
    expect(observations).toContain('2 observations, newest first')
    const lessons = renderNotes({
      ...base,
      query: { kind: 'lessons', page: 1, view: 'plain' },
      entries: {
        kind: 'lessons',
        rows: [
          {
            id: 7,
            fund: 'quant',
            kind: 'execution',
            tradeId: 4,
            lesson: 'Use limits.',
            createdAt: '2026-09-05T00:00:00.000Z',
          },
          {
            id: 8,
            fund: 'quant',
            kind: 'psyche',
            tradeId: null,
            lesson: 'Breathe.',
            createdAt: '2026-09-05T00:00:00.000Z',
          },
        ],
      },
    })
    expect(lessons).toContain(
      '<div class="title">Order placement</div><div class="meta"><span class="tag">Quant</span><span>trade #4</span>',
    )
    expect(lessons).toContain(
      '<div class="title">Psyche</div><div class="meta"><span class="tag">Quant</span><span class="num">',
    )
    expect(renderNotes({ ...base, entries: { kind: 'notes', rows: [] } })).toContain(
      '<p class="muted">Nothing here yet.</p>',
    )
  })
})

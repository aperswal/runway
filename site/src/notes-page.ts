import { z } from 'zod'
import type { Fund, Lesson, Note, Observation } from './db/schema'
import { clamped, filterBar, filterCss, pillRow, segmented, type Choice } from './filter-bar'
import { escape } from './html'
import { shell } from './shell'

export const notesQuery = z.object({
  fund: z.string().optional(),
  kind: z.enum(['notes', 'observations', 'lessons']).default('notes'),
  page: z.coerce.number().int().positive().default(1),
  view: z.enum(['plain', 'agent']).default('plain'),
})
export type NotesQuery = z.infer<typeof notesQuery>
export type Kind = NotesQuery['kind']
export type Entries =
  | { kind: 'notes'; rows: Note[] }
  | { kind: 'observations'; rows: Observation[] }
  | { kind: 'lessons'; rows: Lesson[] }
export type NotesData = {
  url: string
  query: NotesQuery
  funds: { fund: Fund; n: number }[]
  kindTotals: Record<Kind, number>
  total: number
  pages: number
  entries: Entries
}

const TIMESTAMP_LENGTH = 16
const LABELS: Record<Kind, string> = {
  notes: 'Notes',
  observations: 'Observations',
  lessons: 'Lessons',
}
const LESSON_LABELS = { technical: 'Technical', execution: 'Order placement', psyche: 'Psyche' }
const DESCRIPTIONS: Record<Kind, string> = {
  notes: 'What each fund manager decided after every run, and why.',
  observations: 'Short market observations the fund managers recorded during their runs.',
  lessons:
    'What each fund learned from its trades: technical calls, order placement and its own psyche.',
}
const KINDS = Object.entries(LABELS).map(([key, label]) => ({ key: key as Kind, label }))

const css = `
main{display:flex;flex-direction:column;gap:0;padding:20px 20px 40px;max-width:880px;margin:0 auto}
@media(min-width:960px){main{padding:36px 64px 64px}}
${filterCss}
`

export const when = (iso: string): string => iso.slice(0, TIMESTAMP_LENGTH).replace('T', ' ')

export const keepView = (params: URLSearchParams, view: 'plain' | 'agent'): void => {
  if (view === 'agent') {
    params.set('view', 'agent')
  }
}

export function href(q: NotesQuery, patch: Partial<NotesQuery>): string {
  const params = new URLSearchParams()
  const fund = 'fund' in patch ? patch.fund : q.fund
  if (fund !== undefined) {
    params.set('fund', fund)
  }
  params.set('kind', patch.kind ?? q.kind)
  keepView(params, patch.view ?? q.view)
  const page = patch.page ?? 1
  if (page > 1) {
    params.set('page', String(page))
  }
  return `/notes?${params.toString()}`
}

function bar(d: NotesData): string {
  const kinds: Choice[] = KINDS.map((k) => ({
    label: k.label,
    href: href(d.query, { kind: k.key }),
    active: d.query.kind === k.key,
    n: d.kindTotals[k.key],
  }))
  const all = d.funds.reduce((sum, f) => sum + f.n, 0)
  const funds: Choice[] = [
    {
      label: 'All',
      href: href(d.query, { fund: undefined }),
      active: d.query.fund === undefined,
      n: all,
    },
    ...d.funds
      .filter((f) => f.fund.status === 'active' || f.n > 0)
      .map((f) => ({
        label: f.fund.name,
        href: href(d.query, { fund: f.fund.id }),
        active: d.query.fund === f.fund.id,
        n: f.n,
      })),
  ]
  return filterBar(
    segmented(kinds),
    wordingSwitch(d.query, (view) => href(d.query, { view })),
    [pillRow(funds)],
  )
}

export const wordingSwitch = (
  q: { view: 'plain' | 'agent' },
  link: (view: 'plain' | 'agent') => string,
): string =>
  segmented(
    (['plain', 'agent'] as const).map((view) => ({
      label: view === 'plain' ? 'Plain words' : 'Agent',
      href: link(view),
      active: q.view === view,
    })),
  )

type Row = { id: number; fund: string; createdAt: string }
type Piece = {
  row: Row
  title: string
  fundName: string
  tags: string[]
  html: string
  text: string
}

const entry = (x: Piece): string =>
  `<div class="entry"><div class="title">${x.title}</div><div class="meta"><span class="tag">${escape(x.fundName)}</span>${x.tags.map((t) => `<span>${t}</span>`).join('')}<span class="num">${when(x.row.createdAt)}</span></div>${clamped(`e${x.row.id}`, x.html, x.text)}</div>`

function entries(e: Entries, names: Record<string, string>): string {
  const name = (fund: string): string => names[fund] ?? fund
  if (e.kind === 'notes') {
    return e.rows
      .map((n) =>
        entry({
          row: n,
          title: escape(n.title),
          fundName: name(n.fund),
          tags: [],
          html: escape(n.body),
          text: n.body,
        }),
      )
      .join('')
  }
  if (e.kind === 'lessons') {
    return e.rows
      .map((l) =>
        entry({
          row: l,
          title: LESSON_LABELS[l.kind],
          fundName: name(l.fund),
          tags: l.tradeId === null ? [] : [`trade #${l.tradeId}`],
          html: escape(l.lesson),
          text: l.lesson,
        }),
      )
      .join('')
  }
  return e.rows
    .map((o) =>
      entry({
        row: o,
        title: `${o.symbol === null ? '' : `${escape(o.symbol)} `}${escape(o.metric)}${o.value === null ? '' : ` = ${o.value}`}`,
        fundName: name(o.fund),
        tags: [],
        html: `${escape(o.note)}\n<span class="sub">${escape(o.source)}</span>`,
        text: o.note,
      }),
    )
    .join('')
}

export function pager(q: { page: number }, pages: number, link: (page: number) => string): string {
  if (pages <= 1) {
    return ''
  }
  const newer = q.page > 1 ? `<a href="${link(q.page - 1)}">Newer</a>` : '<span></span>'
  const older = q.page < pages ? `<a href="${link(q.page + 1)}">Older</a>` : '<span></span>'
  return `<div class="pager num">${newer}<span class="muted">Page ${q.page} of ${pages}</span>${older}</div>`
}

export function renderNotes(d: NotesData): string {
  const label = LABELS[d.query.kind]
  const names = Object.fromEntries(d.funds.map((f) => [f.fund.id, f.fund.name]))
  const list = entries(d.entries, names)
  const body = `<main><div class="title"><h1>Notes</h1><div class="sub">${d.total} ${label.toLowerCase()}, newest first</div></div>${bar(d)}${list === '' ? '<p class="muted">Nothing here yet.</p>' : `<div class="list">${list}</div>`}${pager(d.query, d.pages, (page) => href(d.query, { page }))}</main>`
  return shell('notes', body, css, {
    title: `Runway ${label.toLowerCase()}`,
    description: DESCRIPTIONS[d.query.kind],
    url: d.url,
  })
}

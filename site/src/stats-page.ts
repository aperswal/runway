import { symbolsOf } from './analyses'
import { type Analysis, type AnalysisKind, type Monitor } from './db/schema'
import { escape, pct, signClass } from './html'
import { clamped, filterBar, filterCss, pillRow, segmented, type Choice } from './filter-bar'
import { keepView, pager, when, wordingSwitch } from './notes-page'
import { shell } from './shell'
import type { StatsData, StatsQuery, Strategy } from './stats'

const PERCENT = 100
const CENTS = 2
const DATE_LENGTH = 10

const KIND_LABELS: Record<AnalysisKind, string> = {
  statistical: 'Statistical',
  technical: 'Technical',
  fundamental: 'Fundamental',
  simulation: 'Simulations',
  consequences: 'Consequences',
  backtest: 'Backtests',
  indicators: 'Indicators',
  strategy: 'Strategies',
}
export const KINDS = Object.keys(KIND_LABELS) as AnalysisKind[]
export const kindLabel = (kind: AnalysisKind): string => KIND_LABELS[kind]
const VERDICT_CLASS: Record<NonNullable<Analysis['verdict']>, string> = {
  adopt: 'up',
  reject: 'down',
  inconclusive: 'muted',
  watch: 'muted',
}

const css = `
main{display:flex;flex-direction:column;gap:0;padding:20px 20px 40px;max-width:880px;margin:0 auto}
@media(min-width:960px){main{padding:36px 64px 64px}}
${filterCss}
h3{font-size:14px;font-weight:600;margin:0 0 8px}
.rank{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 14px;align-items:center;padding:12px 0;border-top:1px solid var(--line);font-size:14px}
.rank .bar{height:6px;border-radius:999px;background:var(--chip);overflow:hidden;grid-column:1/-1}.rank .bar div{height:6px;border-radius:999px;background:var(--ink)}
.rank .n{font-size:13px;font-weight:600;text-align:right}
.chip{padding:2px 8px;border-radius:999px;background:var(--chip);font-size:12px;font-weight:600}
`

const day = (iso: string): string => iso.slice(0, DATE_LENGTH)

const filterParams = (merged: StatsQuery): URLSearchParams => {
  const params = new URLSearchParams()
  if (merged.section !== 'analyses') {
    params.set('section', merged.section)
  }
  for (const key of ['kind', 'fund', 'symbol'] as const) {
    const value = merged[key]
    if (value !== undefined) {
      params.set(key, value)
    }
  }
  return params
}

export function href(q: StatsQuery, patch: Partial<StatsQuery>): string {
  const params = filterParams({ ...q, ...patch })
  if ((patch.page ?? 1) > 1) {
    params.set('page', String(patch.page))
  }
  keepView(params, patch.view ?? q.view)
  const text = params.toString()
  return text === '' ? '/stats' : `/stats?${text}`
}

const SECTIONS = [
  { key: 'analyses', label: 'Analyses' },
  { key: 'watching', label: 'Watching' },
  { key: 'strategies', label: 'Best strategies' },
] as const

function bar(d: StatsData): string {
  const sections: Choice[] = SECTIONS.map((x) => ({
    label: x.label,
    href: href(d.query, { section: x.key }),
    active: d.query.section === x.key,
    ...(x.key === 'watching' ? { n: d.monitors.length } : {}),
  }))
  const total = d.kinds.reduce((sum, k) => sum + k.n, 0)
  const kinds: Choice[] = [
    {
      label: 'All',
      href: href(d.query, { kind: undefined }),
      active: d.query.kind === undefined,
      n: total,
    },
    ...d.kinds.map((k) => ({
      label: KIND_LABELS[k.key],
      href: href(d.query, { kind: k.key }),
      active: d.query.kind === k.key,
      n: k.n,
    })),
  ]
  const funds: Choice[] = [
    {
      label: 'All funds',
      href: href(d.query, { fund: undefined }),
      active: d.query.fund === undefined,
    },
    ...Object.entries(d.fundNames).map(([id, name]) => ({
      label: name,
      href: href(d.query, { fund: id }),
      active: d.query.fund === id,
    })),
  ]
  const side = wordingSwitch(d.query, (view) => href(d.query, { view }))
  const rows = d.query.section === 'analyses' ? [pillRow(kinds), pillRow(funds)] : [pillRow(funds)]
  return filterBar(segmented(sections), side, rows)
}

function watching(monitors: Monitor[]): string {
  if (monitors.length === 0) {
    return '<p class="muted">No events being watched.</p>'
  }
  const rows = monitors.map(
    (m) =>
      `<div class="rank"><div><b>${escape(m.symbol)}</b> ${escape(m.event)}${m.status === 'due' ? ' <span class="chip">due</span>' : ''}<div class="sub">${escape(m.watch)}</div></div><div class="n num muted">${day(m.eventAt)}</div></div>`,
  )
  return `<div class="list">${rows.join('')}</div>`
}

function leaderboard(strategies: Strategy[]): string {
  if (strategies.length === 0) {
    return '<p class="muted">No backtests with a return yet.</p>'
  }
  const top = Math.max(...strategies.map((s) => Math.abs(s.returnPct)), 1)
  const rows = strategies.map((s) => {
    const dd = s.drawdownPct === null ? '' : ` &middot; drawdown ${s.drawdownPct.toFixed(CENTS)}%`
    const width = ((Math.max(0, s.returnPct) / top) * PERCENT).toFixed(0)
    return `<div class="rank"><div>${escape(s.title)}<div class="sub">${escape(s.symbols.join(', '))}${dd}</div></div><div class="n num ${signClass(s.returnPct)}">${pct(s.returnPct)}</div><div class="bar"><div style="width:${width}%"></div></div></div>`
  })
  return `<div class="list">${rows.join('')}</div>`
}

const figure = (value: number | string): string =>
  typeof value === 'number' ? String(Number(value.toFixed(CENTS))) : escape(value)

function entry(a: Analysis, fundNames: Record<string, string>): string {
  const verdict =
    a.verdict === null ? '' : `<span class="dot ${VERDICT_CLASS[a.verdict]}">${a.verdict}</span>`
  const symbols = symbolsOf(a)
  const tiles = Object.entries(a.figures)
    .map(
      ([k, v]) =>
        `<div class="tile"><span>${escape(k)}</span><b class="num">${figure(v)}</b></div>`,
    )
    .join('')
  return `<div class="entry"><div class="title">${escape(a.title)}</div><div class="meta"><span class="tag">${KIND_LABELS[a.kind]}</span>${verdict}<span>${escape(fundNames[a.fund] ?? a.fund)}</span>${symbols.length > 0 ? `<span>${escape(symbols.join(', '))}</span>` : ''}<span class="num">${when(a.createdAt)}</span></div>${clamped(`a${a.id}`, escape(a.body), a.body)}${tiles === '' ? '' : `<div class="tiles">${tiles}</div>`}</div>`
}

const DESCRIPTION =
  'Market analyses, event monitors and the strategies the funds are testing, ranked by result.'

function section(d: StatsData): string {
  if (d.query.section === 'watching') {
    return watching(d.monitors)
  }
  if (d.query.section === 'strategies') {
    return leaderboard(d.strategies)
  }
  const list = d.entries.map((a) => entry(a, d.fundNames)).join('')
  const feed =
    list === '' ? '<p class="muted">Nothing here yet.</p>' : `<div class="list">${list}</div>`
  return `${feed}${pager(d.query, d.pages, (page) => href(d.query, { page }))}`
}

const subtitle = (d: StatsData): string => {
  if (d.query.section === 'watching') {
    return `${d.monitors.length} events`
  }
  if (d.query.section === 'strategies') {
    return 'ranked by return'
  }
  const kind = d.query.kind === undefined ? 'analyses' : KIND_LABELS[d.query.kind].toLowerCase()
  return `${d.total} ${kind}, newest first`
}

export function renderStats(d: StatsData & { url: string }): string {
  const body = `<main><div class="title"><h1>Stats</h1><div class="sub">${subtitle(d)}</div></div>${bar(d)}<div id="analyses">${section(d)}</div></main>`
  return shell('stats', body, css, { title: 'Runway stats', description: DESCRIPTION, url: d.url })
}

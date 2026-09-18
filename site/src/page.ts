import { chartSvg, costChartSvg } from './chart'
import { pct, signClass, usd } from './html'
import { HORIZONS } from './horizons'
import { closedRows, holdingRows, queuedRows } from './page-rows'
import { fundRows, lastRunNote, signedUsd, survivalCard } from './page-sections'
import { pageScript } from './page-script'
import { shell } from './shell'
import type { Summary } from './summary'

export const PAGE_PATH = '/'
const ONE_DECIMAL = 1
const HORIZON_LABELS: Record<(typeof HORIZONS)[number], string> = {
  '1D': '1D',
  '1W': '1W',
  '1M': '1M',
  '3M': '3M',
  ALL: 'All',
}
const SPAN_LABELS: Record<(typeof HORIZONS)[number], string> = {
  '1D': 'today',
  '1W': 'past week',
  '1M': 'past month',
  '3M': 'past 3 months',
  ALL: 'all time',
}

const changeLine = (s: Summary): string => {
  const h = s.horizons.find((x) => x.label === s.horizon)
  const baseline = h?.baseline ?? null
  if (baseline === null) {
    return ''
  }
  const diff = s.equity - baseline
  return `${signedUsd(diff)}${h?.pct === undefined || h.pct === null ? '' : ` (${pct(h.pct)})`} <span class="muted" style="font-weight:400">${SPAN_LABELS[s.horizon]}</span>`
}

const baselines = (s: Summary): string =>
  JSON.stringify(Object.fromEntries(s.horizons.map((h) => [h.label, h.baseline])))

const css = `
.col{display:flex;flex-direction:column;gap:40px;min-width:0}
.rail{display:flex;flex-direction:column;gap:24px;min-width:0}
.equity{font-size:44px;font-weight:600;letter-spacing:-.03em;line-height:1}
@media(min-width:960px){.equity{font-size:56px}}
.change{font-size:15px;font-weight:500;margin-top:8px}
.chart{width:100%;height:180px;display:block;overflow:visible;cursor:crosshair;touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}.chart[hidden]{display:none}
@media(min-width:960px){.chart{height:260px}}
.plot{position:relative}
.chart.selecting>polygon,.chart.selecting>polyline{opacity:.35}
.tip{position:absolute;display:flex;flex-direction:column;align-items:center;gap:1px;padding:5px 9px;border-radius:8px;background:var(--ink);color:var(--bg);font-size:13px;font-weight:600;white-space:nowrap;pointer-events:none;z-index:1}.tip[hidden]{display:none}
.tip span{font-size:11px;font-weight:400;opacity:.7}
.pills{display:flex;gap:6px;margin-top:14px}
.pills a{font-size:13px;font-weight:600;padding:10px 14px;border-radius:999px;color:var(--muted)}
@media(min-width:960px){.pills a{padding:6px 12px}}
.pills a.active{background:var(--chip);color:var(--ink)}
.stat .k{font-size:12px;color:var(--muted)}.stat .v{font-size:20px;font-weight:600}
.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:center}
.detail{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--muted)}
@media(min-width:960px){.row{grid-template-columns:minmax(0,1fr) auto auto}.detail{grid-column:auto;flex-direction:column;align-items:flex-end;gap:2px;font-size:13px;padding-right:24px}}
.pager{display:flex;justify-content:space-between;align-items:center;padding:12px 0;font-size:13px;font-weight:600}

`

const DESCRIPTION =
  'Claude trades a $1,000 Alpaca account to cover its own $200 a month subscription. Live equity, holdings, closed trades and runway.'

export function renderPage(s: Summary, url: string): string {
  const m = s.money.month
  const active = s.horizons.find((x) => x.label === s.horizon)
  const tone = signClass(s.equity - (active?.baseline ?? s.equity))
  return shell(
    'portfolio',
    `<h1 class="sr">Runway: Claude trades to pay for its own subscription</h1>
<main>
<div class="col">
<div>
<div class="equity num" id="equity" data-cash="${s.cash}" data-equity="${s.equity}" data-h="${s.horizon}" data-baselines='${baselines(s)}'>${usd(s.equity)}</div>
<div class="change num ${tone}" id="change">${changeLine(s)}</div>
</div>
<div>
<div class="plot"><div class="tip num" id="tip" hidden><b></b><span></span></div>${HORIZONS.map((h) => chartSvg(s.charts[h], h, h === s.horizon)).join('')}</div>
<nav class="pills">${HORIZONS.map((h) => `<a href="/?h=${h}" data-h="${h}" class="${h === s.horizon ? 'active' : ''}">${HORIZON_LABELS[h]}</a>`).join('')}</nav>
</div>
<section><h2>Holdings</h2>${holdingRows(s)}</section>
${queuedRows(s)}
<section><h2>Closed</h2>${closedRows(s)}</section>
</div>
<aside class="rail">
${survivalCard(s)}
<div class="stats">
<div class="stat"><div class="k">Runway from profit</div><div class="v num">${s.money.runwayMonths.toFixed(ONE_DECIMAL)} mo</div></div>
<div class="stat"><div class="k">Costs</div><div class="v num">${usd(m.costs.totalUsd)}</div></div>
<div class="stat"><div class="k">Paid out</div><div class="v num">${usd(s.money.payouts.totalUsd)}</div></div>
</div>
<details><summary>Return vs costs</summary>${costChartSvg(s.money.window.series)}<p class="muted num">Claude ${usd(m.costs.subscriptionUsd)}, Cloudflare ${usd(m.costs.platformUsd)}, X posts ${usd(m.costs.xPostsUsd)}. Tokens at API rates would be ${usd(m.costs.apiEquivalentUsd)}.</p></details>
<section><h2>Funds</h2>${fundRows(s)}</section>
<section>${lastRunNote(s)}</section>
</aside>
</main>
<script>${pageScript()}</script>`,
    css,
    { title: 'Runway', description: DESCRIPTION, url },
  )
}

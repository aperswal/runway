import type { CostPoint } from './costs'
import type { Horizon, Point } from './horizons'

const WIDTH = 600
const HEIGHT = 160
const PAD = 4
const MIN_POINTS = 2

type Scale = { x: (i: number, n: number) => number; y: (v: number) => number }

function scale(values: number[]): Scale {
  const min = Math.min(...values)
  const span = Math.max(...values) - min
  const safeSpan = span === 0 ? 1 : span
  return {
    x: (i, n) => PAD + (i / (n - 1)) * (WIDTH - MIN_POINTS * PAD),
    y: (v) => HEIGHT - PAD - ((v - min) / safeSpan) * (HEIGHT - MIN_POINTS * PAD),
  }
}

const polyline = (values: number[], s: Scale, extra: string): string =>
  `<polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" ${extra} points="${values.map((v, i) => `${s.x(i, values.length).toFixed(1)},${s.y(v).toFixed(1)}`).join(' ')}"/>`

export function costChartSvg(points: CostPoint[]): string {
  if (points.length < MIN_POINTS) {
    return '<p class="muted">Collecting data.</p>'
  }
  const returns = points.map((p) => p.returnUsd)
  const costs = points.map((p) => p.costUsd)
  const s = scale([...returns, ...costs])
  return `<svg class="chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="Return versus costs"><g class="up">${polyline(returns, s, '')}</g><g class="down">${polyline(costs, s, 'stroke-dasharray="6 4"')}</g></svg><p class="muted legend"><span class="up">Net return</span> &middot; <span class="down">Costs</span></p>`
}

const EMPTY_LINE = HEIGHT / MIN_POINTS

const hover = (horizon: Horizon, points: string): string =>
  `<clipPath id="sel-${horizon}"><rect class="clip" x="0" y="0" width="0" height="${HEIGHT}"></rect></clipPath><g class="sel" clip-path="url(#sel-${horizon})" style="opacity:0"><polygon fill="currentColor" fill-opacity="0.18" points=""></polygon><polyline fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" points="${points}"/></g><line class="hair" x1="0" y1="0" x2="0" y2="${HEIGHT}" stroke="var(--muted)" stroke-width="1" vector-effect="non-scaling-stroke" style="opacity:0"></line><path class="dot" d="M0 0h0" stroke="currentColor" stroke-width="8" stroke-linecap="round" vector-effect="non-scaling-stroke" style="opacity:0"></path>`

const frame = (horizon: Horizon, active: boolean): string =>
  `data-h="${horizon}"${active ? '' : ' hidden'}`

export function chartSvg(series: Point[], horizon: Horizon, active: boolean): string {
  if (series.length < MIN_POINTS) {
    return `<svg class="chart muted" ${frame(horizon, active)} viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="Equity over time, no data yet"><line x1="${PAD}" y1="${EMPTY_LINE}" x2="${WIDTH - PAD}" y2="${EMPTY_LINE}" stroke="var(--line)" stroke-dasharray="3 6"></line></svg>`
  }
  const equities = series.map((p) => p.equity)
  const min = Math.min(...equities)
  const span = Math.max(...equities) - min
  const safeSpan = span === 0 ? 1 : span
  const x = (i: number): number => PAD + (i / (series.length - 1)) * (WIDTH - MIN_POINTS * PAD)
  const y = (v: number): number =>
    HEIGHT - PAD - ((v - min) / safeSpan) * (HEIGHT - MIN_POINTS * PAD)
  const coords = series.map((p, i) => ({
    x: Number(x(i).toFixed(1)),
    y: Number(y(p.equity).toFixed(1)),
    at: p.takenAt,
    equity: p.equity,
  }))
  const points = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const data = JSON.stringify(coords.map((c) => [c.x, c.y, c.at, c.equity]))
  const tone = Number(equities.at(-1)) >= Number(equities[0]) ? 'up' : 'down'
  const first = y(Number(equities[0])).toFixed(1)
  return `<svg class="chart ${tone}" ${frame(horizon, active)} data-points='${data}' viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="Equity over time"><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0.16"></stop><stop offset="1" stop-color="currentColor" stop-opacity="0"></stop></linearGradient></defs><polygon fill="url(#equityFill)" points="${PAD},${HEIGHT} ${points} ${(WIDTH - PAD).toFixed(1)},${HEIGHT}"></polygon><line x1="${PAD}" y1="${first}" x2="${WIDTH - PAD}" y2="${first}" stroke="var(--line)" stroke-dasharray="3 6"></line><polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" points="${points}"/>${hover(horizon, points)}</svg>`
}

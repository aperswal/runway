import { Resvg, initWasm } from '@resvg/resvg-wasm'
import wasm from '@resvg/resvg-wasm/index_bg.wasm'
import type { Db } from './db/client'
import regular from './fonts/schibsted-grotesk-400.ttf'
import semibold from './fonts/schibsted-grotesk-600.ttf'
import { escape, pct, usd } from './html'
import { loadSeries, percentChange, type Point } from './horizons'
import { signedUsd } from './page-sections'

const WIDTH = 1200
const HEIGHT = 675
const PAD = 72
const PLOT_TOP = 300
const PLOT_BOTTOM = 590
const MIN_POINTS = 2
const COLORS = { bg: '#0f1110', ink: '#f4f5f3', muted: '#8b918c', up: '#3ddc84', down: '#ff6b5e' }
const FONT = 'Schibsted Grotesk'
const SIZES = { brand: 24, equity: 96, change: 30, date: 22 }
const LINE_WIDTH = 4
const FILL_OPACITY = 0.18
const DASH = '4 10'
const BRAND_Y = 108
const EQUITY_Y = 208
const CHANGE_Y = 246

let ready: Promise<void> | null = null
const ensureWasm = (): Promise<void> => {
  ready ??= initWasm(wasm)
  return ready
}

const dateText = (now: Date): string =>
  now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  })

type Placed = { x: number; y: number }

const place = (series: Point[]): Placed[] => {
  const equities = series.map((p) => p.equity)
  const min = Math.min(...equities)
  const span = Math.max(...equities) - min
  const safeSpan = span === 0 ? 1 : span
  const width = WIDTH - MIN_POINTS * PAD
  const height = PLOT_BOTTOM - PLOT_TOP
  return equities.map((e, i) => ({
    x: PAD + (i / (series.length - 1)) * width,
    y: PLOT_BOTTOM - ((e - min) / safeSpan) * height,
  }))
}

const plot = (series: Point[], tone: string): string => {
  const placed = place(series)
  const points = placed.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const first = Number(placed[0]?.y).toFixed(1)
  return `<defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tone}" stop-opacity="${FILL_OPACITY}"/><stop offset="1" stop-color="${tone}" stop-opacity="0"/></linearGradient></defs><polygon fill="url(#fill)" points="${PAD},${PLOT_BOTTOM} ${points} ${WIDTH - PAD},${PLOT_BOTTOM}"/><line x1="${PAD}" y1="${first}" x2="${WIDTH - PAD}" y2="${first}" stroke="${COLORS.muted}" stroke-opacity="0.5" stroke-dasharray="${DASH}"/><polyline fill="none" stroke="${tone}" stroke-width="${LINE_WIDTH}" stroke-linejoin="round" stroke-linecap="round" points="${points}"/>`
}

type Label = { x: number; y: number; size: number; fill: string; extra?: string }

const text = (label: Label, body: string): string =>
  `<text x="${label.x}" y="${label.y}" font-family="${FONT}" font-size="${label.size}" fill="${label.fill}" ${label.extra ?? ''}>${body}</text>`

const changeLine = (series: Point[]): string => {
  const first = series[0]?.equity
  if (first === undefined) {
    return text({ x: PAD, y: CHANGE_Y, size: SIZES.change, fill: COLORS.muted }, 'No data yet')
  }
  const last = series.reduce((_, p) => p.equity, first)
  const change = percentChange(first, last)
  const tone = last >= first ? COLORS.up : COLORS.down
  const amount = escape(`${signedUsd(last - first)}${change === null ? '' : ` (${pct(change)})`}`)
  return `<text x="${PAD}" y="${CHANGE_Y}" font-family="${FONT}" font-size="${SIZES.change}"><tspan fill="${tone}" font-weight="600">${amount}</tspan><tspan fill="${COLORS.muted}" dx="12">all time</tspan></text>`
}

const header = (series: Point[], now: Date): string => {
  const last = series.at(-1)?.equity ?? 0
  const brand = {
    x: PAD,
    y: BRAND_Y,
    size: SIZES.brand,
    fill: COLORS.ink,
    extra: 'font-weight="600" letter-spacing="0.5"',
  }
  const date = {
    x: WIDTH - PAD,
    y: BRAND_Y,
    size: SIZES.date,
    fill: COLORS.muted,
    extra: 'text-anchor="end"',
  }
  const equity = {
    x: PAD,
    y: EQUITY_Y,
    size: SIZES.equity,
    fill: COLORS.ink,
    extra: 'font-weight="600" letter-spacing="-3"',
  }
  return `${text(brand, 'Runway')}${text(date, escape(dateText(now)))}${text(equity, escape(usd(last)))}${changeLine(series)}`
}

export function chartImageSvg(series: Point[], now: Date): string {
  const first = series[0]?.equity
  const last = series.at(-1)?.equity ?? 0
  const tone = last >= (first ?? last) ? COLORS.up : COLORS.down
  const body = series.length < MIN_POINTS ? '' : plot(series, tone)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.bg}"/>${header(series, now)}${body}</svg>`
}

export async function renderPng(svg: string): Promise<Uint8Array> {
  await ensureWasm()
  const resvg = new Resvg(svg, {
    font: {
      fontBuffers: [new Uint8Array(regular), new Uint8Array(semibold)],
      defaultFontFamily: FONT,
      loadSystemFonts: false,
    },
  })
  return resvg.render().asPng()
}

export async function chartImage(db: Db, now: Date): Promise<Uint8Array> {
  return renderPng(chartImageSvg(await loadSeries(db, 'ALL', now), now))
}

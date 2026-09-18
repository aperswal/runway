import { describe, expect, it } from 'vitest'
import { chartImageSvg, renderPng } from './chart-image'

const now = new Date('2026-09-02T20:00:00.000Z')
const series = [
  { takenAt: '2026-09-01T00:00:00.000Z', equity: 1000 },
  { takenAt: '2026-09-01T12:00:00.000Z', equity: 1040 },
  { takenAt: '2026-09-02T00:00:00.000Z', equity: 951.32 },
]

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]
const IHDR_WIDTH_OFFSET = 16
const read32 = (bytes: Uint8Array, at: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(at)

describe('chartImageSvg', () => {
  it('draws the all-time number, change and line', () => {
    const svg = chartImageSvg(series, now)
    expect(svg).toContain('>$951.32<')
    expect(svg).toContain('<tspan fill="#ff6b5e" font-weight="600">-$48.68 (-4.87%)</tspan>')
    expect(svg).toContain('>all time</tspan>')
    expect(svg).toContain('>Sep 2, 2026<')
    expect(svg).toContain('<polyline fill="none" stroke="#ff6b5e"')
    expect(svg).toContain('points="72.0,430.8 600.0,300.0 1128.0,590.0"')
  })

  it('colors a gain green', () => {
    const svg = chartImageSvg([series[0]!, series[1]!], now)
    expect(svg).toContain('<tspan fill="#3ddc84" font-weight="600">+$40.00 (+4.00%)</tspan>')
    expect(svg).toContain('stroke="#3ddc84"')
  })

  it('handles a flat line and a zero start', () => {
    const flat = chartImageSvg([series[0]!, series[0]!], now)
    expect(flat).toContain('points="72.0,590.0 1128.0,590.0"')
    const zero = chartImageSvg(
      [
        { takenAt: 'a', equity: 0 },
        { takenAt: 'b', equity: 5 },
      ],
      now,
    )
    expect(zero).toContain('>+$5.00</tspan>')
  })

  it('renders a placeholder without data', () => {
    const empty = chartImageSvg([], now)
    expect(empty).toContain('>No data yet<')
    expect(empty).toContain('>$0.00<')
    expect(empty).not.toContain('<polyline')
    expect(chartImageSvg([series[0]!], now)).not.toContain('<polyline')
  })
})

describe('renderPng', () => {
  it('rasterizes the svg into a 1200 by 675 png', async () => {
    const png = await renderPng(chartImageSvg(series, now))
    expect([...png.slice(0, PNG_SIGNATURE.length)]).toEqual(PNG_SIGNATURE)
    expect(read32(png, IHDR_WIDTH_OFFSET)).toBe(1200)
    expect(read32(png, IHDR_WIDTH_OFFSET + 4)).toBe(675)
    const again = await renderPng(chartImageSvg([], now))
    expect(again.length).toBeGreaterThan(0)
  })
})

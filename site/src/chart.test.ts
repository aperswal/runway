import { describe, expect, it } from 'vitest'
import { chartSvg, costChartSvg } from './chart'

const STROKE =
  '<polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"'

describe('chartSvg', () => {
  it('asks for patience with fewer than two points', () => {
    expect(chartSvg([{ takenAt: 't', equity: 1 }], '1D', true)).toBe(
      '<svg class="chart muted" data-h="1D" viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label="Equity over time, no data yet"><line x1="4" y1="80" x2="596" y2="80" stroke="var(--line)" stroke-dasharray="3 6"></line></svg>',
    )
    expect(chartSvg([], '3M', false)).toContain('<svg class="chart muted" data-h="3M" hidden ')
  })

  it('draws an up chart scaled to the range', () => {
    const svg = chartSvg(
      [
        { takenAt: 'a', equity: 100 },
        { takenAt: 'b', equity: 150 },
        { takenAt: 'c', equity: 200 },
      ],
      '1M',
      true,
    )
    expect(svg).toBe(
      `<svg class="chart up" data-h="1M" data-points='[[4,156,"a",100],[300,80,"b",150],[596,4,"c",200]]' viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label="Equity over time"><defs><linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0.16"></stop><stop offset="1" stop-color="currentColor" stop-opacity="0"></stop></linearGradient></defs><polygon fill="url(#equityFill)" points="4,160 4.0,156.0 300.0,80.0 596.0,4.0 596.0,160"></polygon><line x1="4" y1="156.0" x2="596" y2="156.0" stroke="var(--line)" stroke-dasharray="3 6"></line>${STROKE} stroke-linejoin="round" stroke-linecap="round" points="4.0,156.0 300.0,80.0 596.0,4.0"/><clipPath id="sel-1M"><rect class="clip" x="0" y="0" width="0" height="160"></rect></clipPath><g class="sel" clip-path="url(#sel-1M)" style="opacity:0"><polygon fill="currentColor" fill-opacity="0.18" points=""></polygon><polyline fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round" points="4.0,156.0 300.0,80.0 596.0,4.0"/></g><line class="hair" x1="0" y1="0" x2="0" y2="160" stroke="var(--muted)" stroke-width="1" vector-effect="non-scaling-stroke" style="opacity:0"></line><path class="dot" d="M0 0h0" stroke="currentColor" stroke-width="8" stroke-linecap="round" vector-effect="non-scaling-stroke" style="opacity:0"></path></svg>`,
    )
  })

  it('draws a down chart', () => {
    const svg = chartSvg(
      [
        { takenAt: 'a', equity: 200 },
        { takenAt: 'b', equity: 100 },
      ],
      '1W',
      false,
    )
    expect(svg).toContain('class="chart down" data-h="1W" hidden data-points=')
  })

  it('judges the tone by the last point, not the second', () => {
    const svg = chartSvg(
      [
        { takenAt: 'a', equity: 100 },
        { takenAt: 'b', equity: 50 },
        { takenAt: 'c', equity: 200 },
      ],
      'ALL',
      true,
    )
    expect(svg).toContain('class="chart up"')
  })

  it('keeps a flat series in the middle and calls it up', () => {
    const svg = chartSvg(
      [
        { takenAt: 'a', equity: 5 },
        { takenAt: 'b', equity: 5 },
      ],
      '1D',
      true,
    )
    expect(svg).toContain('class="chart up"')
    expect(svg).toContain('points="4.0,156.0 596.0,156.0"')
    expect(svg).toContain(`data-points='[[4,156,"a",5],[596,156,"b",5]]'`)
  })
})

describe('costChartSvg', () => {
  it('asks for patience with fewer than two points', () => {
    expect(costChartSvg([])).toBe('<p class="muted">Collecting data.</p>')
  })

  it('draws return and cost lines on one scale', () => {
    const svg = costChartSvg([
      { takenAt: 'a', returnUsd: 0, costUsd: 0 },
      { takenAt: 'b', returnUsd: 10, costUsd: 5 },
    ])
    expect(svg).toBe(
      `<svg class="chart" viewBox="0 0 600 160" preserveAspectRatio="none" role="img" aria-label="Return versus costs"><g class="up">${STROKE}  points="4.0,156.0 596.0,4.0"/></g><g class="down">${STROKE} stroke-dasharray="6 4" points="4.0,156.0 596.0,80.0"/></g></svg><p class="muted legend"><span class="up">Net return</span> &middot; <span class="down">Costs</span></p>`,
    )
  })

  it('scales from the lowest value, not from zero', () => {
    const svg = costChartSvg([
      { takenAt: 'a', returnUsd: 5, costUsd: 5 },
      { takenAt: 'b', returnUsd: 10, costUsd: 5 },
    ])
    expect(svg).toContain('points="4.0,156.0 596.0,4.0"')
    expect(svg).toContain('stroke-dasharray="6 4" points="4.0,156.0 596.0,156.0"')
  })

  it('spreads three points evenly', () => {
    const svg = costChartSvg([
      { takenAt: 'a', returnUsd: 0, costUsd: 0 },
      { takenAt: 'b', returnUsd: 5, costUsd: 0 },
      { takenAt: 'c', returnUsd: 10, costUsd: 0 },
    ])
    expect(svg).toContain('points="4.0,156.0 300.0,80.0 596.0,4.0"')
  })

  it('keeps flat lines in the middle', () => {
    const svg = costChartSvg([
      { takenAt: 'a', returnUsd: 0, costUsd: 0 },
      { takenAt: 'b', returnUsd: 0, costUsd: 0 },
    ])
    expect(svg).toContain('points="4.0,156.0 596.0,156.0"')
  })
})

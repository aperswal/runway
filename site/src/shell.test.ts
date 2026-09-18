import { afterEach, describe, expect, it, vi } from 'vitest'
import { imageVersion, shell } from './shell'

afterEach(() => vi.useRealTimers())

describe('imageVersion', () => {
  it('changes every ten minutes so shares fetch a fresh chart', () => {
    expect(imageVersion(new Date('2026-09-04T16:05:00.000Z'))).toBe('2980896')
    expect(imageVersion(new Date('2026-09-04T16:09:59.000Z'))).toBe('2980896')
    expect(imageVersion(new Date('2026-09-04T16:10:00.000Z'))).toBe('2980897')
  })
})

describe('shell', () => {
  it('wraps a body with the head, font, nav and extra css, escaping the title', () => {
    const meta = {
      title: 'Runway <notes>',
      description: 'Notes & more',
      url: 'https://runway.test/notes?fund=a',
    }
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T16:05:00.000Z'))
    const html = shell('notes', '<main>x</main>', '.x{}', meta)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>Runway &lt;notes&gt;</title>')
    expect(html).toContain(
      '<meta name="description" content="Notes &amp; more"><link rel="canonical" href="https://runway.test/notes?fund=a"><meta name="theme-color" content="#0f1110">',
    )
    expect(html).toContain(
      '<meta property="og:type" content="website"><meta property="og:site_name" content="Runway"><meta property="og:title" content="Runway &lt;notes&gt;"><meta property="og:description" content="Notes &amp; more"><meta property="og:url" content="https://runway.test/notes?fund=a"><meta property="og:image" content="https://runway.test/og.png?v=2980896"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="675">',
    )
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Runway &lt;notes&gt;"><meta name="twitter:description" content="Notes &amp; more"><meta name="twitter:image" content="https://runway.test/og.png?v=2980896">',
    )
    expect(html).toContain(
      '<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">',
    )
    expect(html).toContain('family=Schibsted+Grotesk')
    expect(html).toContain(
      '<nav class="top"><a href="/" class="">Portfolio</a><a href="/notes" class="active">Notes</a><a href="/stats" class="">Stats</a></nav>',
    )
    expect(html).toContain('nav.top{display:flex')
    expect(html).toContain('.x{}</style>')
    expect(html).toContain('<main>x</main>\n</body></html>')
  })
})

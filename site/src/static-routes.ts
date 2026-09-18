import { Hono } from 'hono'
import icon32 from './assets/icon-32.png'
import icon180 from './assets/icon-180.png'
import icon512 from './assets/icon-512.png'
import { chartImage } from './chart-image'
import type { Deps } from './deps'
import type { Bindings } from './env'
import { OG_IMAGE } from './shell'

type Env = { Bindings: Bindings; Variables: { deps: Deps } }

const ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0f1110"/><line x1="12" y1="40" x2="52" y2="40" stroke="#3a3f3c" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/><polyline points="12,44 22,38 30,41 40,28 52,18" fill="none" stroke="#3ddc84" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="52" cy="18" r="5" fill="#3ddc84"/></svg>'

const DAY = 'public, max-age=86400'
const TEN_MINUTES = 'public, max-age=600'
const PAGES = ['/', '/notes', '/stats']

const png = (bytes: ArrayBuffer): Response =>
  new Response(bytes, { headers: { 'content-type': 'image/png', 'cache-control': DAY } })

const manifest = (): string =>
  '{"name":"Runway","short_name":"Runway","description":"Claude trades to cover its own subscription.","start_url":"/","display":"standalone","background_color":"#0f1110","theme_color":"#0f1110","icons":[{"src":"/apple-touch-icon.png","sizes":"180x180","type":"image/png"},{"src":"/icon-512.png","sizes":"512x512","type":"image/png"}]}'

const sitemap = (origin: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${PAGES.map((p) => `<url><loc>${origin}${p}</loc></url>`).join('')}</urlset>`

export const statics = new Hono<Env>()

statics.get('/icon.svg', (c) =>
  c.body(ICON_SVG, undefined, { 'content-type': 'image/svg+xml', 'cache-control': DAY }),
)
statics.get('/favicon.ico', () => png(icon32))
statics.get('/favicon.png', () => png(icon32))
statics.get('/apple-touch-icon.png', () => png(icon180))
statics.get('/icon-512.png', () => png(icon512))
statics.get('/manifest.webmanifest', (c) =>
  c.body(manifest(), undefined, {
    'content-type': 'application/manifest+json',
    'cache-control': DAY,
  }),
)
statics.get('/robots.txt', (c) =>
  c.text(
    `User-agent: *\nAllow: /\nDisallow: /internal/\nDisallow: /data/\nSitemap: ${new URL(c.var.deps.config.SITE_URL).origin}/sitemap.xml\n`,
    undefined,
    { 'cache-control': DAY },
  ),
)
statics.get('/sitemap.xml', (c) =>
  c.body(sitemap(new URL(c.var.deps.config.SITE_URL).origin), undefined, {
    'content-type': 'application/xml',
    'cache-control': DAY,
  }),
)
statics.get(OG_IMAGE.path, async (c) => {
  const image = await chartImage(c.var.deps.db, new Date())
  return new Response(image, {
    headers: { 'content-type': 'image/png', 'cache-control': TEN_MINUTES },
  })
})

import { escape } from './html'

export type Section = 'portfolio' | 'notes' | 'stats'

const NAV: { key: Section; href: string; label: string }[] = [
  { key: 'portfolio', href: '/', label: 'Portfolio' },
  { key: 'notes', href: '/notes', label: 'Notes' },
  { key: 'stats', href: '/stats', label: 'Stats' },
]

const css = `
:root{color-scheme:light dark;--bg:#fcfcfb;--ink:#141614;--muted:#767a76;--line:#e8eae6;--up:#12a150;--down:#d6402f;--chip:#f0f2ee}
@media(prefers-color-scheme:dark){:root{--bg:#0f1110;--ink:#f4f5f3;--muted:#8b918c;--line:#242826;--up:#3ddc84;--down:#ff6b5e;--chip:#1d211f}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Schibsted Grotesk","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;font-size:15px;line-height:1.5}
a{color:inherit;text-decoration:none}a:hover,a:focus-visible{opacity:.7;outline:none}
.num{font-variant-numeric:tabular-nums}
.up{color:var(--up)}.down{color:var(--down)}.muted{color:var(--muted)}
header{display:flex;justify-content:space-between;align-items:center;padding:20px 20px;border-bottom:1px solid var(--line)}
.brand{font-size:16px;font-weight:600;letter-spacing:.02em}
main{display:grid;grid-template-columns:minmax(0,1fr);gap:40px;padding:32px 20px 64px;max-width:1312px;margin:0 auto}
@media(min-width:960px){header{padding:24px 64px}main{grid-template-columns:2fr 1fr;gap:64px;padding:48px 64px 64px}}
h2{font-size:14px;font-weight:600;margin:0 0 8px}
.row{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:14px 0;border-top:1px solid var(--line)}
.rows{display:flex;flex-direction:column}.rows .row:last-child{border-bottom:1px solid var(--line)}
.lead{display:flex;flex-direction:column;gap:3px;min-width:0}
.ticker{font-size:16px;font-weight:600}.sub{font-size:12px;color:var(--muted)}
.exits{display:none;font-size:14px;color:var(--muted)}
@media(min-width:960px){.exits{display:block}}
.value{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
.amount{font-size:16px;font-weight:500}.delta{font-size:12px;font-weight:600}
.card{display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid var(--line);border-radius:16px}
.bar{height:8px;border-radius:999px;background:var(--chip);overflow:hidden}.bar div{height:8px;border-radius:999px;background:var(--up)}
.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.stat{display:flex;flex-direction:column;gap:4px;padding:14px;border:1px solid var(--line);border-radius:14px}
details{font-size:13px}summary{cursor:pointer;font-weight:600;color:var(--muted);list-style:none}summary::-webkit-details-marker{display:none}
.note{font-size:15px;line-height:1.5;margin:8px 0}
nav.top{display:flex;gap:18px;font-size:14px;font-weight:500;color:var(--muted)}
nav.top a.active{color:var(--ink)}
.stamp{font-size:14px;font-weight:500;color:var(--muted)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`

export type Meta = { title: string; description: string; url: string }

export const OG_IMAGE = { path: '/og.png', width: 1200, height: 675 }
const IMAGE_VERSION_MS = 600_000

export const imageVersion = (now: Date): string =>
  String(Math.floor(now.getTime() / IMAGE_VERSION_MS))
const THEME = '#0f1110'

const social = (meta: Meta): string => {
  const origin = new URL(meta.url).origin
  const image = `${origin}${OG_IMAGE.path}?v=${imageVersion(new Date())}`
  const title = escape(meta.title)
  return `<meta property="og:type" content="website"><meta property="og:site_name" content="Runway"><meta property="og:title" content="${title}"><meta property="og:description" content="${escape(meta.description)}"><meta property="og:url" content="${escape(meta.url)}"><meta property="og:image" content="${image}"><meta property="og:image:width" content="${OG_IMAGE.width}"><meta property="og:image:height" content="${OG_IMAGE.height}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${escape(meta.description)}"><meta name="twitter:image" content="${image}">`
}

const ICONS =
  '<link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="icon" href="/favicon.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">'

export function shell(active: Section, body: string, extraCss: string, meta: Meta): string {
  const links = NAV.map(
    (n) => `<a href="${n.href}" class="${n.key === active ? 'active' : ''}">${n.label}</a>`,
  ).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(meta.title)}</title>
<meta name="description" content="${escape(meta.description)}"><link rel="canonical" href="${escape(meta.url)}"><meta name="theme-color" content="${THEME}">${social(meta)}${ICONS}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600&display=swap">
<style>${css}${extraCss}</style></head>
<body>
<header><div style="display:flex;gap:28px;align-items:baseline"><div class="brand">Runway</div><nav class="top">${links}</nav></div></header>
${body}
</body></html>`
}

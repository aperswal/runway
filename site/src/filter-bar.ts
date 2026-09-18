import { escape } from './html'

export type Choice = { label: string; href: string; active: boolean; n?: number }

export const filterCss = `
h1{font-size:22px;font-weight:600;letter-spacing:-.01em;margin:0}
.title{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding-bottom:4px}
.title .sub{white-space:nowrap}
.fbar{position:sticky;top:0;z-index:2;background:var(--bg);display:flex;flex-direction:column;gap:10px;padding:12px 0 10px;border-bottom:1px solid var(--line)}
@media(min-width:960px){.fbar{gap:12px;padding:16px 0 12px}}
.fbar .top{display:flex;flex-direction:column;gap:10px}
@media(min-width:960px){.fbar .top{flex-direction:row;justify-content:space-between;align-items:center;gap:16px}}
.seg{display:flex;gap:2px;padding:3px;border-radius:12px;background:var(--chip)}
.seg a{flex:1;text-align:center;padding:11px 12px;border-radius:9px;font-size:14px;font-weight:600;color:var(--muted);white-space:nowrap}
@media(min-width:960px){.seg a{flex:0 1 auto;padding:7px 14px}}
.seg a.active{background:var(--bg);color:var(--ink);box-shadow:0 1px 2px rgba(20,22,20,.08)}
.seg a span{font-weight:400;margin-left:6px}
.side{display:flex;gap:10px;align-items:center}
.side .seg a{padding:6px 12px;font-size:13px}
.pillrow{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none}
.pillrow::-webkit-scrollbar{display:none}
.pillrow a{white-space:nowrap;padding:10px 14px;border-radius:999px;font-size:13px;font-weight:600;color:var(--muted)}
@media(min-width:960px){.pillrow a{padding:6px 12px}}
.pillrow a.active{background:var(--chip);color:var(--ink)}
.pillrow a span{font-weight:400;margin-left:6px}
.entry{display:flex;flex-direction:column;gap:8px;padding:18px 0;border-top:1px solid var(--line)}
@media(min-width:960px){.entry{padding:20px 0}}
.entry .title{font-size:16px;font-weight:600;line-height:1.35;display:block;padding:0}
@media(min-width:960px){.entry .title{font-size:17px}}
.meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;font-size:12px;color:var(--muted)}
.meta .tag{padding:2px 8px;border-radius:999px;background:var(--chip);color:var(--ink);font-weight:600}
.meta .dot{display:inline-flex;align-items:center;gap:6px}
.meta .dot:before{content:"";width:8px;height:8px;border-radius:999px;background:currentColor}
.entry .body{font-size:15px;line-height:1.55;white-space:pre-wrap}
.entry .more{display:none}
.entry .clamp{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.entry .more:checked ~ .clamp{display:block;-webkit-line-clamp:unset}
.entry label{font-size:13px;font-weight:600;color:var(--muted);cursor:pointer;width:max-content}
.entry .more:checked ~ label{display:none}
.tiles{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none}
.tiles::-webkit-scrollbar{display:none}
.tile{flex:0 0 auto;display:flex;flex-direction:column;gap:2px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;min-width:88px;white-space:nowrap}
.tile span{font-size:11px;color:var(--muted)}.tile b{font-size:14px;font-weight:600}
.list{display:flex;flex-direction:column}.list:after{content:"";border-top:1px solid var(--line)}
.pager{display:flex;justify-content:space-between;align-items:center;padding:16px 0;font-size:13px;font-weight:600}
`

const link = (c: Choice): string =>
  `<a href="${c.href}" class="${c.active ? 'active' : ''}">${escape(c.label)}${c.n === undefined ? '' : `<span class="num">${c.n}</span>`}</a>`

export const segmented = (choices: Choice[]): string =>
  `<nav class="seg">${choices.map(link).join('')}</nav>`

export const pillRow = (choices: Choice[]): string =>
  `<nav class="pillrow">${choices.map(link).join('')}</nav>`

export const filterBar = (top: string, side: string, rows: string[]): string =>
  `<div class="fbar"><div class="top">${top}<div class="side">${side}</div></div>${rows.join('')}</div>`

const CLAMP_CHARS = 280

export function clamped(id: string, html: string, text: string): string {
  if (text.length <= CLAMP_CHARS) {
    return `<div class="body">${html}</div>`
  }
  return `<input type="checkbox" class="more" id="${id}"><div class="body clamp">${html}</div><label for="${id}">More</label>`
}

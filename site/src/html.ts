const entities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
const CENTS = 2
const UNSAFE_CHARS = /[&<>"']/g
const replaceEntity = (c: string): string => entities[c as keyof typeof entities]

export const escape = (value: string | number): string =>
  String(value).replace(UNSAFE_CHARS, replaceEntity)

export const usd = (n: number): string =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: CENTS })

export const pct = (n: number | null): string =>
  n === null ? '&ndash;' : `${n >= 0 ? '+' : ''}${n.toFixed(CENTS)}%`

export function signClass(n: number | null): string {
  if (n === null) {
    return ''
  }
  return n >= 0 ? 'up' : 'down'
}

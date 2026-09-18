const HEX_RADIX = 16
const HEX_PREFIX = '#x'
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

export type Capped = { text: string; chars: number; truncated: boolean }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match: string, code: string) => {
    if (code.toLowerCase().startsWith(HEX_PREFIX)) {
      return String.fromCodePoint(parseInt(code.slice(HEX_PREFIX.length), HEX_RADIX))
    }
    if (code.startsWith('#')) {
      return String.fromCodePoint(Number(code.slice(1)))
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match
  })
}

export function stripHtml(html: string): string {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|h[1-6]|blockquote|pre)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  return collapseWhitespace(decodeEntities(text))
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function capText(text: string, limit: number): Capped {
  return { text: text.slice(0, limit), chars: text.length, truncated: text.length > limit }
}

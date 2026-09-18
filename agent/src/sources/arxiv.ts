import { fetchText } from './http.ts'
import type { Command, Source } from './source.ts'
import { decodeEntities, stripHtml } from './text.ts'

const API_URL = 'https://export.arxiv.org/api/query'
const DEFAULT_MAX = 10

type Paper = {
  id: string
  title: string
  authors: string[]
  published: string
  summary: string
  url: string
}

const ENTRY = /<entry>([\s\S]*?)<\/entry>/g

const captures = (text: string, pattern: RegExp): string[] =>
  [...text.matchAll(pattern)].flatMap((match) => match.slice(1))

const field = (entry: string, tag: string): string => {
  const text = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(entry)?.[1]
  return text === undefined ? '' : decodeEntities(stripHtml(text)).replace(/\s+/g, ' ').trim()
}

const authorsOf = (entry: string): string[] =>
  captures(entry, /<author>[\s\S]*?<name>([\s\S]*?)<\/name>/g).map((name) => name.trim())

export function parsePapers(xml: string): Paper[] {
  return captures(xml, ENTRY).map((entry) => {
    const id = field(entry, 'id')
    return {
      id,
      title: field(entry, 'title'),
      authors: authorsOf(entry),
      published: field(entry, 'published'),
      summary: field(entry, 'summary'),
      url: id,
    }
  })
}

const search: Command = {
  name: 'search',
  usage: 'arxiv search --q "<query>" [--max 10]',
  about: 'Search arXiv (q-fin, stat, cs) for papers; returns title, authors, date, abstract, url',
  run: async (flags) => {
    const q = flags.q ?? ''
    const max = flags.max === undefined ? DEFAULT_MAX : Number(flags.max)
    const query = new URLSearchParams()
    query.set('search_query', `all:${q}`)
    query.set('start', '0')
    query.set('max_results', String(max))
    query.set('sortBy', 'relevance')
    return { query: q, papers: parsePapers(await fetchText(`${API_URL}?${query.toString()}`)) }
  },
}

export const arxiv: Source = { name: 'arxiv', commands: [search] }

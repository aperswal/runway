import type { Flags } from './args.ts'
import { intFlag, requireFlag } from './args.ts'
import { fetchText } from './http.ts'
import type { Source } from './source.ts'
import { decodeEntities, stripHtml } from './text.ts'

const USER_AGENT = 'runway adityaperswal@gmail.com'
const DEFAULT_MAX = 20
const AUDIO_PREFIX = 'audio/'

type FeedItem = {
  title: string
  link: string
  published: string
  text: string
  audio: string[]
}

export type Feed = { title: string; items: FeedItem[] }

const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/

const unwrap = (raw: string): string => {
  const inner = raw.replace(CDATA, '$1')
  return inner === raw ? decodeEntities(raw) : inner
}

function elements(xml: string, tag: string): string[] {
  const pattern = new RegExp(`(?<=<${tag}(?:\\s[^>]*)?>)[\\s\\S]*?(?=</${tag}>)`, 'g')
  return [...xml.matchAll(pattern)].map((match) => match[0])
}

function element(xml: string, tags: string[]): string | undefined {
  for (const tag of tags) {
    const found = elements(xml, tag)[0]
    if (found !== undefined) {
      return unwrap(found)
    }
  }
  return undefined
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`(?<=\\s${name}=")[^"]*(?=")`).exec(tag)
  return match === null ? undefined : decodeEntities(match[0])
}

function tagsNamed(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((match) => match[0])
}

function atomLink(entry: string): string {
  const hrefs = tagsNamed(entry, 'link')
    .filter((tag) => (attribute(tag, 'rel') ?? 'alternate') === 'alternate')
    .map((tag) => attribute(tag, 'href') ?? '')
  return hrefs[0] ?? ''
}

function audioUrls(item: string): string[] {
  return [...tagsNamed(item, 'enclosure'), ...tagsNamed(item, 'link')]
    .filter((tag) => attribute(tag, 'type')?.startsWith(AUDIO_PREFIX) === true)
    .map((tag) => attribute(tag, 'url') ?? attribute(tag, 'href') ?? '')
    .filter((url) => url.length > 0)
}

function toItem(item: string): FeedItem {
  return {
    title: decodeEntities(element(item, ['title']) ?? ''),
    link: element(item, ['link']) ?? atomLink(item),
    published: element(item, ['pubDate', 'published', 'updated', 'dc:date']) ?? '',
    text: stripHtml(element(item, ['content:encoded', 'content', 'description', 'summary']) ?? ''),
    audio: audioUrls(item),
  }
}

export function parseFeed(xml: string, max: number): Feed {
  const entries = [...elements(xml, 'item'), ...elements(xml, 'entry')]
  const [head = xml] = xml.split(/<(?:item|entry)\b/, 1)
  return {
    title: element(head, ['title']) ?? '',
    items: entries.slice(0, max).map(toItem),
  }
}

export const rss: Source = {
  name: 'rss',
  commands: [
    {
      name: 'fetch',
      usage: 'rss fetch --url <feed url> [--max 20]',
      about: 'RSS 2.0 or Atom feed as plain text items, with podcast audio URLs',
      run: async (flags: Flags): Promise<Feed> => {
        const xml = await fetchText(requireFlag(flags, 'url'), {
          headers: { 'user-agent': USER_AGENT },
        })
        return parseFeed(xml, intFlag(flags, 'max', DEFAULT_MAX))
      },
    },
  ],
}

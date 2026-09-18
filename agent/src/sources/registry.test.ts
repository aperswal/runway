import { describe, expect, it } from 'vitest'
import { UsageError } from '../errors.ts'
import { findCommand, SOURCES, SOURCES_HELP } from './registry.ts'

const help = [
  "apify run --actor <owner/name> --input '<json>' [--timeout 300]  run any Apify actor synchronously and return its dataset items",
  'apify search --q "<what to scrape>" [--max 10]  find actors on the Apify store by popularity; then read their inputs with apify schema',
  "apify schema --actor <owner/name>  read an actor's input fields, types, defaults and options before running it",
  "apify scrape --urls <url,url> [--selector '<css>'] [--page-function '<js>'] [--max 20] [--timeout 300]  scrape pages with the generic cheerio-scraper: --selector returns the text of matching elements per page, or supply your own pageFunction; test with one url, then schedule_job the working command",
  'youtube search --q "<query>" [--max 10]  search YouTube videos (Data API v3)',
  'youtube comments --video <id> [--max 50]  top comments on a video (Data API v3)',
  'youtube transcript --video <id> [--lang en]  plain-text captions of a video, no key needed',
  'reddit search --q "<query>" [--sub wallstreetbets] [--max 25] [--sort relevance|new|top]  search Reddit posts, optionally within one subreddit',
  'reddit thread --id <postId> [--max 100]  a post with its comment tree flattened (depth per comment)',
  'hn search --q "<query>" [--max 25] [--tags story|comment]  search Hacker News stories and comments by relevance (Algolia)',
  'lesswrong recent [--max 20]  newest LessWrong posts with a plain-text excerpt',
  'lesswrong search --q "<query>" [--max 20]  full-text search of LessWrong posts',
  'arxiv search --q "<query>" [--max 10]  Search arXiv (q-fin, stat, cs) for papers; returns title, authors, date, abstract, url',
  'rss fetch --url <feed url> [--max 20]  RSS 2.0 or Atom feed as plain text items, with podcast audio URLs',
  'edgar filings --ticker NVDA [--form 10-K] [--max 5]  recent SEC filings for a ticker with primary document URLs',
  'edgar document --url <primary doc url> [--section "Risk Factors"]  a filing as plain text, optionally one Item section, capped at 60k characters',
  'world quote --symbols 7203.T,^N225,^FTSE,EURUSD=X,BZ=F  latest price and day change for any Yahoo Finance symbol: non-US stocks (7203.T, SAP.DE, 0700.HK), indexes (^N225, ^STOXX50E), FX (EURUSD=X), commodities (BZ=F)',
  'world history --symbol 7203.T [--range 3mo] [--interval 1d]  daily closes for a Yahoo Finance symbol (ranges 5d, 1mo, 3mo, 6mo, 1y, 5y)',
  'transcribe --url <audio url>  download an audio file and transcribe it with OpenAI whisper-1',
]

describe('SOURCES', () => {
  it('registers every source and command by name', () =>
    expect(SOURCES.map((source) => [source.name, source.commands.map((c) => c.name)])).toEqual([
      ['apify', ['run', 'search', 'schema', 'scrape']],
      ['youtube', ['search', 'comments', 'transcript']],
      ['reddit', ['search', 'thread']],
      ['hn', ['search']],
      ['lesswrong', ['recent', 'search']],
      ['arxiv', ['search']],
      ['rss', ['fetch']],
      ['edgar', ['filings', 'document']],
      ['world', ['quote', 'history']],
      ['transcribe', ['']],
    ]))
})

describe('SOURCES_HELP', () => {
  it('has one usage line per command', () => expect(SOURCES_HELP).toBe(help.join('\n')))
})

describe('findCommand', () => {
  it('finds a command', () => expect(findCommand('hn', 'search').name).toBe('search'))
  it('finds the bare transcribe command', () =>
    expect(findCommand('transcribe', '').usage).toBe('transcribe --url <audio url>'))
  it('rejects an unknown source', () =>
    expect(() => findCommand('bloomberg', 'x')).toThrow(
      new UsageError(
        'Unknown source "bloomberg". Sources: apify, youtube, reddit, hn, lesswrong, arxiv, rss, edgar, world, transcribe',
      ),
    ))
  it('rejects an unknown command', () =>
    expect(() => findCommand('edgar', 'top')).toThrow(
      new UsageError(
        'Unknown command "top" for edgar. Try: edgar filings --ticker NVDA [--form 10-K] [--max 5] | edgar document --url <primary doc url> [--section "Risk Factors"]',
      ),
    ))
})

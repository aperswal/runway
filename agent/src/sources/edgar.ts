import { z } from 'zod'
import { SourceError } from '../errors.ts'
import type { Flags } from './args.ts'
import { intFlag, requireFlag } from './args.ts'
import { fetchJson, fetchText } from './http.ts'
import type { Source } from './source.ts'
import type { Capped } from './text.ts'
import { capText, stripHtml } from './text.ts'

const USER_AGENT = 'runway adityaperswal@gmail.com'
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json'
const SUBMISSIONS_URL = 'https://data.sec.gov/submissions/CIK'
const ARCHIVES_URL = 'https://www.sec.gov/Archives/edgar/data'
const CIK_DIGITS = 10
const DEFAULT_MAX = 5
const MAX_DOCUMENT_CHARS = 60000
const NEXT_ITEM = /\b[Ii](?:tem|TEM)\s+\d+[A-Ca-c]?[.:]?\s*[A-Z]/

const HEADERS = { headers: { 'user-agent': USER_AGENT } }

const tickersSchema = z.record(
  z.string(),
  z.object({ cik_str: z.number(), ticker: z.string(), title: z.string() }),
)

const submissionsSchema = z.object({
  name: z.string(),
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string()),
      form: z.array(z.string()),
      filingDate: z.array(z.string()),
      reportDate: z.array(z.string()),
      primaryDocument: z.array(z.string()),
      primaryDocDescription: z.array(z.string()),
    }),
  }),
})

type Filing = {
  form: string
  filed: string
  period: string
  description: string
  url: string
}

type Filings = { ticker: string; cik: number; name: string; filings: Filing[] }

type EdgarDocument = Capped & { url: string; section: string | null; note?: string }

async function cikFor(ticker: string): Promise<number> {
  const tickers = await fetchJson(TICKERS_URL, tickersSchema, HEADERS)
  const entry = Object.values(tickers).find((company) => company.ticker === ticker)
  if (entry === undefined) {
    throw new SourceError(`Ticker ${ticker} is not in the SEC company list`)
  }
  return entry.cik_str
}

async function filings(flags: Flags): Promise<Filings> {
  const ticker = requireFlag(flags, 'ticker').toUpperCase()
  const form = flags.form
  const max = intFlag(flags, 'max', DEFAULT_MAX)
  const cik = await cikFor(ticker)
  const padded = String(cik).padStart(CIK_DIGITS, '0')
  const submissions = await fetchJson(
    `${SUBMISSIONS_URL}${padded}.json`,
    submissionsSchema,
    HEADERS,
  )
  const recent = submissions.filings.recent
  const rows = recent.accessionNumber
    .map((accession, index) => ({
      form: recent.form[index] ?? '',
      filed: recent.filingDate[index] ?? '',
      period: recent.reportDate[index] ?? '',
      description: recent.primaryDocDescription[index] ?? '',
      url: `${ARCHIVES_URL}/${cik}/${accession.replaceAll('-', '')}/${recent.primaryDocument[index] ?? ''}`,
    }))
    .filter((row) => form === undefined || row.form === form)
    .slice(0, max)
  return { ticker, cik, name: submissions.name, filings: rows }
}

function extractSection(text: string, section: string): string {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const heading = new RegExp(`\\bitem\\s+\\d+[a-c]?[.:]?\\s*${escaped}`, 'gi')
  let best = ''
  for (const match of text.matchAll(heading)) {
    const bodyStart = match.index + match[0].length
    const rest = text.slice(bodyStart)
    const end = NEXT_ITEM.exec(rest)?.index ?? rest.length
    const candidate = text.slice(match.index, bodyStart + end)
    if (candidate.length > best.length) {
      best = candidate
    }
  }
  if (best.length === 0) {
    throw new SourceError(`Section "${section}" not found in the document`)
  }
  return best.trim()
}

async function document(flags: Flags): Promise<EdgarDocument> {
  const url = requireFlag(flags, 'url')
  const section = flags.section ?? null
  const html = await fetchText(url, HEADERS)
  const full = stripHtml(html)
  const text = section === null ? full : extractSection(full, section)
  const capped = capText(text, MAX_DOCUMENT_CHARS)
  const note = capped.truncated
    ? `Text truncated to ${MAX_DOCUMENT_CHARS} of ${capped.chars} characters`
    : undefined
  return note === undefined ? { url, section, ...capped } : { url, section, ...capped, note }
}

export const edgar: Source = {
  name: 'edgar',
  commands: [
    {
      name: 'filings',
      usage: 'edgar filings --ticker NVDA [--form 10-K] [--max 5]',
      about: 'recent SEC filings for a ticker with primary document URLs',
      run: filings,
    },
    {
      name: 'document',
      usage: 'edgar document --url <primary doc url> [--section "Risk Factors"]',
      about: 'a filing as plain text, optionally one Item section, capped at 60k characters',
      run: document,
    },
  ],
}

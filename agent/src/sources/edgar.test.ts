import { afterEach, describe, expect, it, vi } from 'vitest'
import { SourceError } from '../errors.ts'
import { edgar } from './edgar.ts'
import type { Command } from './source.ts'

const filings: Command['run'] = (flags, keys) => edgar.commands[0]!.run(flags, keys)
const document: Command['run'] = (flags, keys) => edgar.commands[1]!.run(flags, keys)

const tickers = { '0': { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' } }
const submissions = {
  name: 'NVIDIA CORP',
  filings: {
    recent: {
      accessionNumber: ['0001045810-26-000010', '0001045810-26-000020', '0001045810-26-000030'],
      form: ['10-K', '8-K', '10-K'],
      filingDate: ['2026-02-26', '2026-03-01', '2025-02-26'],
      reportDate: ['2026-01-25', '', '2025-01-26'],
      primaryDocument: ['nvda-10k.htm', 'nvda-8k.htm', 'old-10k.htm'],
      primaryDocDescription: ['10-K', '8-K', '10-K'],
    },
  },
}
const json = (body: unknown) => new Response(JSON.stringify(body))

const stub = (...responses: Response[]) => {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('edgar filings', () => {
  it('maps the ticker to a CIK and lists filings by form', async () => {
    const fetchMock = stub(json(tickers), json(submissions))
    await expect(filings({ ticker: 'nvda', form: '10-K' }, {})).resolves.toEqual({
      ticker: 'NVDA',
      cik: 1045810,
      name: 'NVIDIA CORP',
      filings: [
        {
          form: '10-K',
          filed: '2026-02-26',
          period: '2026-01-25',
          description: '10-K',
          url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000010/nvda-10k.htm',
        },
        {
          form: '10-K',
          filed: '2025-02-26',
          period: '2025-01-26',
          description: '10-K',
          url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000030/old-10k.htm',
        },
      ],
    })
    const headers = { headers: { 'user-agent': 'runway adityaperswal@gmail.com' } }
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://www.sec.gov/files/company_tickers.json',
      headers,
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://data.sec.gov/submissions/CIK0001045810.json',
      headers,
    )
  })
  it('caps with max and tolerates ragged columns', async () => {
    const ragged = {
      name: 'X',
      filings: {
        recent: {
          accessionNumber: ['1-2-3', '4-5-6', '7-8-9'],
          form: ['8-K'],
          filingDate: [],
          reportDate: [],
          primaryDocument: [],
          primaryDocDescription: [],
        },
      },
    }
    stub(json(tickers), json(ragged))
    const result = await filings({ ticker: 'NVDA', max: '2' }, {})
    expect(result).toMatchObject({
      filings: [
        {
          form: '8-K',
          filed: '',
          period: '',
          description: '',
          url: 'https://www.sec.gov/Archives/edgar/data/1045810/123/',
        },
        {
          form: '',
          filed: '',
          period: '',
          description: '',
          url: 'https://www.sec.gov/Archives/edgar/data/1045810/456/',
        },
      ],
    })
  })
  it('fails for an unknown ticker', async () => {
    stub(json(tickers))
    await expect(filings({ ticker: 'ZZZZ' }, {})).rejects.toThrow(
      new SourceError('Ticker ZZZZ is not in the SEC company list'),
    )
  })
})

describe('edgar document', () => {
  const html = `<html><body><p>Table of Contents</p><p>Item 1A. Risk Factors 12</p><p>Item 1B. Unresolved Staff Comments 30</p>
<p>ITEM 1A. RISK FACTORS</p><p>We face many risks. See Item 3, Legal Proceedings.</p><p>Item 1B. Unresolved Staff Comments</p><p>None.</p>
<p>See Item 1A. Risk Factors above.</p><p>Item 6. [Reserved]</p><p>Item 7.</p><p></p><p>Management Discussion</p><p>Revenue grew.</p>
<p>Item</p><p></p><p>10 Directors</p><p>Names.</p></body></html>`
  const sectionOf = (body: string, section: string) => {
    stub(new Response(body))
    return document({ url: 'https://www.sec.gov/x.htm', section }, {})
  }
  it('returns the whole filing as text', async () => {
    stub(new Response(html))
    const result = await document({ url: 'https://www.sec.gov/x.htm' }, {})
    expect(result).toStrictEqual({
      url: 'https://www.sec.gov/x.htm',
      section: null,
      text: expect.stringContaining('Revenue grew.'),
      chars: expect.any(Number),
      truncated: false,
    })
  })
  it('extracts the longest matching Item section', async () =>
    expect(await sectionOf(html, 'Risk Factors')).toMatchObject({
      section: 'Risk Factors',
      text: 'ITEM 1A. RISK FACTORS\nWe face many risks. See Item 3, Legal Proceedings.',
    }))
  it('matches the section name literally', async () =>
    expect(await sectionOf(html, '[Reserved]')).toMatchObject({ text: 'Item 6. [Reserved]' }))
  it('stops at a heading split over a blank line', async () =>
    expect(await sectionOf(html, 'Management Discussion')).toMatchObject({
      text: 'Item 7.\n\nManagement Discussion\nRevenue grew.',
    }))
  it('runs a section to the end when no later Item follows', async () =>
    expect(await sectionOf(html, 'Directors')).toMatchObject({
      text: 'Item\n\n10 Directors\nNames.',
    }))
  it('keeps the first of equally long matches', async () =>
    expect(
      await sectionOf(
        '<p>Item 2. Properties A</p><p>Item 3. Legal</p><p>Item 2. Properties B</p><p>Item 3. Legal</p>',
        'Properties',
      ),
    ).toMatchObject({ text: 'Item 2. Properties A' }))
  it('fails when the section is absent', async () => {
    await expect(sectionOf(html, 'Legal Proceedings')).rejects.toThrow(
      new SourceError('Section "Legal Proceedings" not found in the document'),
    )
  })
  it('truncates long documents with a note', async () => {
    stub(new Response(`<p>${'a'.repeat(60001)}</p>`))
    await expect(document({ url: 'https://www.sec.gov/big.htm' }, {})).resolves.toMatchObject({
      chars: 60001,
      truncated: true,
      note: 'Text truncated to 60000 of 60001 characters',
    })
  })
})

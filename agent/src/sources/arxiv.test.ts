import { afterEach, describe, expect, it, vi } from 'vitest'
import { arxiv, parsePapers } from './arxiv.ts'
import type { Command } from './source.ts'

const run: Command['run'] = (flags, keys) => arxiv.commands[0]!.run(flags, keys)

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query: search_query=all:momentum</title>
  <entry>
    <id>http://arxiv.org/abs/2101.00001v2</id>
    <published>2021-01-01T00:00:00Z</published>
    <title type="html">Momentum   Everywhere:
  A Study</title>
    <summary>We show &amp;amp; tell <b>that</b> momentum works.


Twice.&amp;nbsp;</summary>
    <author>
      <name>Ada Lovelace</name>
    </author>
    <author><arxiv:affiliation>X</arxiv:affiliation> <name> Alan Turing </name></author>
    <link href="http://arxiv.org/abs/2101.00001v2" rel="alternate" type="text/html"/>
  </entry>
  <entry><title>Bare</title></entry>
</feed>`

const papers = [
  {
    id: 'http://arxiv.org/abs/2101.00001v2',
    title: 'Momentum Everywhere: A Study',
    authors: ['Ada Lovelace', 'Alan Turing'],
    published: '2021-01-01T00:00:00Z',
    summary: 'We show & tell that momentum works. Twice.',
    url: 'http://arxiv.org/abs/2101.00001v2',
  },
  { id: '', title: 'Bare', authors: [], published: '', summary: '', url: '' },
]

afterEach(() => vi.unstubAllGlobals())

describe('parsePapers', () => {
  it('maps every entry to a paper', () => expect(parsePapers(xml)).toEqual(papers))
  it('returns nothing without entries', () => expect(parsePapers('<feed></feed>')).toEqual([]))
})

describe('arxiv search', () => {
  it('queries the export API and parses the feed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(xml))
    vi.stubGlobal('fetch', fetchMock)
    await expect(run({ q: 'momentum' }, {})).resolves.toEqual({ query: 'momentum', papers })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://export.arxiv.org/api/query?search_query=all%3Amomentum&start=0&max_results=10&sortBy=relevance',
      undefined,
    )
  })
  it('forwards max and defaults the query to empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<feed></feed>'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(run({ max: '3' }, {})).resolves.toEqual({ query: '', papers: [] })
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://export.arxiv.org/api/query?search_query=all%3A&start=0&max_results=3&sortBy=relevance',
    )
  })
})

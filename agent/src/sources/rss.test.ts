import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFeed, rss } from './rss.ts'
import type { Command } from './source.ts'

const run: Command['run'] = (flags, keys) => rss.commands[0]!.run(flags, keys)

const rssXml = `<?xml version="1.0"?><rss version="2.0"><channel><title><![CDATA[Dwarkesh Podcast]]></title>
<item><title> <![CDATA[Ep 1 &amp; more]]> </title><link><![CDATA[https://d.test/ep1?a=1&amp;b=2]]></link>
<pubDate>Tue, 01 Sep 2026 15:41:06 GMT</pubDate>
<description><![CDATA[short]]></description>
<content:encoded><![CDATA[<p>Long &amp; <b>rich</b></p>]]></content:encoded>
<enclosure url="https://d.test/ep1.mp3" length="0" type="audio/mpeg"/>
<enclosure url="https://d.test/cover.png" length="0" type="image/png"/>
</item>
<item><title>Plain &lt;title&gt;</title><link>https://d.test/ep2?a=1&amp;b=2</link><dc:date>2026-09-03T00:00:00Z</dc:date><description>Only description</description><enclosure url="https://d.test/x"/></item>
<item><title>Bonus <![CDATA[Ep 3]]></title><link><![CDATA[https://d.test/ep3]]> tail</link></item>
</channel></rss>`

const atomXml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Releases</title>
<entry><title>v1</title><link rel="enclosure" type="audio/mp4" href="https://g.test/v1.m4a"/>
<link rel="alternate" type="text/html" href="https://g.test/v1"/>
<published>2026-09-01T17:50:12Z</published><content type="html">&lt;h2&gt;Notes&lt;/h2&gt;&lt;p&gt;Hi&lt;/p&gt;</content></entry>
<entry><title>v2</title><link href="https://g.test/v2"/><updated>2026-09-02T00:00:00Z</updated><summary>Sum</summary></entry>
<entry><title>v3</title><enclosure type="audio/mpeg"/></entry>
<entry><id>untitled</id><link/></entry>
</feed>`

afterEach(() => vi.unstubAllGlobals())

describe('parseFeed', () => {
  it('parses RSS 2.0 items with audio enclosures', () =>
    expect(parseFeed(rssXml, 20)).toEqual({
      title: 'Dwarkesh Podcast',
      items: [
        {
          title: 'Ep 1 & more',
          link: 'https://d.test/ep1?a=1&amp;b=2',
          published: 'Tue, 01 Sep 2026 15:41:06 GMT',
          text: 'Long & rich',
          audio: ['https://d.test/ep1.mp3'],
        },
        {
          title: 'Plain <title>',
          link: 'https://d.test/ep2?a=1&b=2',
          published: '2026-09-03T00:00:00Z',
          text: 'Only description',
          audio: [],
        },
        {
          title: 'Bonus <![CDATA[Ep 3]]>',
          link: '<![CDATA[https://d.test/ep3]]> tail',
          published: '',
          text: '',
          audio: [],
        },
      ],
    }))
  it('parses Atom entries', () =>
    expect(parseFeed(atomXml, 20)).toEqual({
      title: 'Releases',
      items: [
        {
          title: 'v1',
          link: 'https://g.test/v1',
          published: '2026-09-01T17:50:12Z',
          text: 'Notes\nHi',
          audio: ['https://g.test/v1.m4a'],
        },
        {
          title: 'v2',
          link: 'https://g.test/v2',
          published: '2026-09-02T00:00:00Z',
          text: 'Sum',
          audio: [],
        },
        { title: 'v3', link: '', published: '', text: '', audio: [] },
        { title: '', link: '', published: '', text: '', audio: [] },
      ],
    }))
  it('handles a feed without a title', () =>
    expect(parseFeed('<rss/>', 5)).toEqual({ title: '', items: [] }))
  it('does not take an item title as the feed title', () =>
    expect(
      parseFeed('<rss><channel><item><title>Only item</title></item></channel></rss>', 5),
    ).toEqual({
      title: '',
      items: [{ title: 'Only item', link: '', published: '', text: '', audio: [] }],
    }))
  it('caps the number of items', () => expect(parseFeed(atomXml, 1).items).toHaveLength(1))
  it('handles a feed without entries', () =>
    expect(parseFeed('<feed><title>Empty</title></feed>', 5)).toEqual({
      title: 'Empty',
      items: [],
    }))
})

describe('rss fetch', () => {
  it('fetches the feed with a user agent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(rssXml))
    vi.stubGlobal('fetch', fetchMock)
    const result = await run({ url: 'https://d.test/feed', max: '1' }, {})
    expect(result).toMatchObject({ title: 'Dwarkesh Podcast' })
    expect((result as { items: unknown[] }).items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledWith('https://d.test/feed', {
      headers: { 'user-agent': 'runway adityaperswal@gmail.com' },
    })
  })
})

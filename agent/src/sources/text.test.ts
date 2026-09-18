import { describe, expect, it } from 'vitest'
import { capText, collapseWhitespace, decodeEntities, stripHtml } from './text.ts'

describe('decodeEntities', () => {
  it('decodes named entities', () =>
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;a&nbsp;b')).toBe('&<>"\'a b'))
  it('decodes decimal and hex references', () =>
    expect(decodeEntities('&#39;&#x27;&#X27;')).toBe("'''"))
  it('leaves unknown entities alone', () => expect(decodeEntities('&bogus;')).toBe('&bogus;'))
})

describe('stripHtml', () => {
  it('drops scripts and styles, keeps text, breaks on block ends', () =>
    expect(
      stripHtml(
        '<style>p{}</style><p>One &amp; <b>two</b></p><script>var x = 1</script><div>three<br>four</div>',
      ),
    ).toBe('One & two\nthree\nfour'))
  it('separates words that a dropped script joined', () =>
    expect(stripHtml('a<script>var x = 1</script>b')).toBe('a b'))
  it('separates words that a dropped tag joined', () =>
    expect(stripHtml('x<b>y</b>z')).toBe('x y z'))
})

describe('collapseWhitespace', () => {
  it('squeezes runs of spaces and blank lines', () =>
    expect(collapseWhitespace('  a \t b \n \n \n\n c  ')).toBe('a b\n\nc'))
  it('trims a space before a newline', () => expect(collapseWhitespace('a \nb')).toBe('a\nb'))
})

describe('capText', () => {
  it('reports when nothing was cut', () =>
    expect(capText('abc', 5)).toEqual({ text: 'abc', chars: 3, truncated: false }))
  it('keeps text that exactly fits', () =>
    expect(capText('abcd', 4)).toEqual({ text: 'abcd', chars: 4, truncated: false }))
  it('cuts to the limit', () =>
    expect(capText('abcdef', 4)).toEqual({ text: 'abcd', chars: 6, truncated: true }))
})

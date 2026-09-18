import { describe, expect, it } from 'vitest'
import { escape, pct, signClass, usd } from './html'

describe('escape', () => {
  it('neutralizes markup in agent-written text', () => {
    expect(escape(`<img src=x onerror="alert('x')">`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;',
    )
  })
  it('accepts numbers', () => expect(escape(3)).toBe('3'))
})

describe('usd', () => {
  it('formats dollars with cents', () => expect(usd(1234.5)).toBe('$1,234.50'))
  it('formats negatives', () => expect(usd(-3)).toBe('-$3.00'))
})

describe('pct', () => {
  it('signs positive values', () => expect(pct(2.345)).toBe('+2.35%'))
  it('leaves negatives signed by the number', () => expect(pct(-1)).toBe('-1.00%'))
  it('renders a dash for null', () => expect(pct(null)).toBe('&ndash;'))
})

describe('signClass', () => {
  it('is up for zero and above', () => expect(signClass(0)).toBe('up'))
  it('is down below zero', () => expect(signClass(-0.1)).toBe('down'))
  it('is empty for null', () => expect(signClass(null)).toBe(''))
})

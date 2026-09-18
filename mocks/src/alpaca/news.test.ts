import { describe, expect, it } from 'vitest'
import { newsView } from './news.ts'

const NOW = new Date('2026-09-01T15:00:00.000Z')

const item = (id: number, headline: string, symbols: string[], hour: string) => ({
  id,
  headline,
  author: 'Mock Newswire',
  created_at: `2026-09-01T${hour}:00:00.000Z`,
  updated_at: `2026-09-01T${hour}:00:00.000Z`,
  summary: headline,
  content: `<p>${headline}</p>`,
  url: `https://news.example.com/${id}`,
  images: [],
  symbols,
  source: 'mock',
})

describe('newsView', () => {
  it('returns every headline one hour apart', () => {
    expect(newsView([], 10, NOW)).toEqual([
      item(1, 'Fed holds rates steady, signals patience on cuts', ['SPY', 'QQQ'], '15'),
      item(2, 'Apple unveils new chips as services revenue hits record', ['AAPL'], '14'),
      item(3, 'Nvidia data center demand outpaces supply again', ['NVDA'], '13'),
      item(4, 'Bitcoin steadies after ETF inflows resume', ['BTCUSD', 'BTC/USD'], '12'),
      item(5, 'Ethereum upgrade lands with lower fees', ['ETHUSD', 'ETH/USD'], '11'),
      item(6, 'Tesla deliveries beat estimates on price cuts', ['TSLA'], '10'),
      item(7, 'Microsoft cloud growth reaccelerates', ['MSFT'], '09'),
      item(8, 'Oil slips as inventories build', ['XOM', 'CVX'], '08'),
    ])
  })

  it('caps by limit', () => {
    expect(newsView([], 3, NOW).map((n) => n.id)).toEqual([1, 2, 3])
  })

  it('filters by symbol case-insensitively', () => {
    const news = newsView(['aapl', 'BTC/USD'], 10, NOW)
    expect(news.map((n) => n.symbols)).toEqual([['AAPL'], ['BTCUSD', 'BTC/USD']])
    expect(newsView(['ZZZZ'], 10, NOW)).toEqual([])
    expect(newsView(['xom'], 10, NOW).map((n) => n.headline)).toEqual([
      'Oil slips as inventories build',
    ])
  })
})

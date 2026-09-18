export type Headline = {
  id: number
  headline: string
  author: string
  created_at: string
  updated_at: string
  summary: string
  content: string
  url: string
  images: never[]
  symbols: string[]
  source: string
}

const HOUR_MS = 3600000

const HEADLINES: { headline: string; symbols: string[] }[] = [
  { headline: 'Fed holds rates steady, signals patience on cuts', symbols: ['SPY', 'QQQ'] },
  { headline: 'Apple unveils new chips as services revenue hits record', symbols: ['AAPL'] },
  { headline: 'Nvidia data center demand outpaces supply again', symbols: ['NVDA'] },
  { headline: 'Bitcoin steadies after ETF inflows resume', symbols: ['BTCUSD', 'BTC/USD'] },
  { headline: 'Ethereum upgrade lands with lower fees', symbols: ['ETHUSD', 'ETH/USD'] },
  { headline: 'Tesla deliveries beat estimates on price cuts', symbols: ['TSLA'] },
  { headline: 'Microsoft cloud growth reaccelerates', symbols: ['MSFT'] },
  { headline: 'Oil slips as inventories build', symbols: ['XOM', 'CVX'] },
]

export function newsView(symbols: string[], limit: number, now: Date): Headline[] {
  const wanted = new Set(symbols.map((s) => s.toUpperCase()))
  const matching =
    wanted.size === 0
      ? HEADLINES
      : HEADLINES.filter((item) => item.symbols.some((s) => wanted.has(s)))
  return matching.slice(0, limit).map((item, index) => {
    const at = new Date(now.getTime() - index * HOUR_MS).toISOString()
    return {
      id: index + 1,
      headline: item.headline,
      author: 'Mock Newswire',
      created_at: at,
      updated_at: at,
      summary: item.headline,
      content: `<p>${item.headline}</p>`,
      url: `https://news.example.com/${index + 1}`,
      images: [],
      symbols: item.symbols,
      source: 'mock',
    }
  })
}

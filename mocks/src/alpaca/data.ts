import { AlpacaBadRequestError, AlpacaNotFoundError } from '../errors.ts'
import {
  dispatch,
  json,
  param,
  symbolsQuery,
  type Handler,
  type MockRequest,
  type Route,
} from '../http.ts'
import { barRange, dailyBars, isWeekdayBar, type Bar } from './bars.ts'
import { newsView } from './news.ts'
import { chainFor, snapshotView as optionSnapshot } from './options.ts'
import { canonicalSymbol, isCrypto, roundCents, type PriceFeed } from './prices.ts'
import {
  CRYPTO_UNIVERSE,
  STOCK_UNIVERSE,
  mostActivesView,
  moversView,
  topCount,
} from './screener.ts'

export type DataDeps = { prices: PriceFeed; now: () => Date }

const DEFAULT_NEWS_LIMIT = 10
const STOCK_TRADE_SIZE = 100
const CRYPTO_TRADE_SIZE = 0.01
const QUOTE_SPREAD = 0.01
const QUOTE_SIZE = 1
const SNAPSHOT_HISTORY = 2

type View = Record<string, unknown>

const stockTrade = (price: number, at: string): View => ({
  t: at,
  x: 'V',
  p: price,
  s: STOCK_TRADE_SIZE,
  c: ['@'],
  i: 1,
  z: 'C',
})

const cryptoTrade = (price: number, at: string): View => ({
  t: at,
  p: price,
  s: CRYPTO_TRADE_SIZE,
  tks: 'B',
  i: 1,
})

const quote = (price: number, at: string): View => ({
  t: at,
  ax: 'V',
  ap: roundCents(price + QUOTE_SPREAD),
  as: QUOTE_SIZE,
  bx: 'V',
  bp: roundCents(price - QUOTE_SPREAD),
  bs: QUOTE_SIZE,
  c: ['R'],
  z: 'C',
})

const latestTrade = (symbol: string, price: number, at: string): View =>
  isCrypto(symbol) ? cryptoTrade(price, at) : stockTrade(price, at)

const requireSymbols = (request: MockRequest): string[] => {
  const symbols = symbolsQuery(request)
  if (symbols.length === 0) {
    throw new AlpacaBadRequestError('symbols query parameter is required')
  }
  return symbols
}

const bySymbol = (request: MockRequest, view: (symbol: string) => unknown): View =>
  Object.fromEntries(requireSymbols(request).map((s) => [canonicalSymbol(s), view(s)]))

const notFound = (): never => {
  throw new AlpacaNotFoundError('endpoint not found')
}

const newsLimit = (request: MockRequest): number => {
  const limit = Number(request.query.get('limit') ?? DEFAULT_NEWS_LIMIT)
  return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_NEWS_LIMIT
}

const snapshotView = (deps: DataDeps, symbol: string): View => {
  const price = deps.prices.current(symbol)
  const at = deps.now().toISOString()
  const history = dailyBars(canonicalSymbol(symbol), barRange(new URLSearchParams(), deps.now()))
  const [prev, last] = history.slice(-SNAPSHOT_HISTORY)
  return {
    latestTrade: latestTrade(symbol, price, at),
    latestQuote: quote(price, at),
    minuteBar: last,
    dailyBar: last,
    prevDailyBar: prev,
  }
}

const optionRoutes = (deps: DataDeps): Route[] => {
  const at = (): string => deps.now().toISOString()
  const trades = (request: MockRequest): View =>
    bySymbol(request, (symbol) => stockTrade(deps.prices.current(symbol), at()))
  return [
    {
      method: 'GET',
      pattern: '/v1beta1/options/trades/latest',
      handle: (request) => json({ trades: trades(request) }),
    },
    {
      method: 'GET',
      pattern: '/v1beta1/options/snapshots',
      handle: (request) =>
        json({
          snapshots: bySymbol(request, (symbol) => optionSnapshot(symbol, deps.prices, at())),
        }),
    },
    {
      method: 'GET',
      pattern: '/v1beta1/options/snapshots/:underlying',
      handle: (_request, params) =>
        json({
          snapshots: Object.fromEntries(
            chainFor(param(params, 'underlying').toUpperCase(), deps.now()).map((c) => [
              c.symbol,
              optionSnapshot(c.symbol, deps.prices, at()),
            ]),
          ),
          next_page_token: null,
        }),
    },
  ]
}

const tradeRoutes = (deps: DataDeps): Route[] => {
  const trades = (request: MockRequest, view: (price: number, at: string) => View): View =>
    bySymbol(request, (symbol) => view(deps.prices.current(symbol), deps.now().toISOString()))
  return [
    {
      method: 'GET',
      pattern: '/v2/stocks/trades/latest',
      handle: (request) => json({ trades: trades(request, stockTrade), currency: 'USD' }),
    },
    {
      method: 'GET',
      pattern: '/v1beta3/crypto/us/latest/trades',
      handle: (request) => json({ trades: trades(request, cryptoTrade) }),
    },
    {
      method: 'GET',
      pattern: '/v1beta1/news',
      handle: (request) =>
        json({
          news: newsView(symbolsQuery(request), newsLimit(request), deps.now()),
          next_page_token: null,
        }),
    },
  ]
}

const barRoutes = (deps: DataDeps): Route[] => {
  const bars = (request: MockRequest, keep: (bar: Bar) => boolean): View =>
    bySymbol(request, (symbol) => {
      const range = barRange(request.query, deps.now())
      return dailyBars(canonicalSymbol(symbol), range).filter(keep).slice(-range.limit)
    })
  const snapshots = (request: MockRequest): View =>
    bySymbol(request, (symbol) => snapshotView(deps, symbol))
  return [
    {
      method: 'GET',
      pattern: '/v2/stocks/bars',
      handle: (request) =>
        json({ bars: bars(request, isWeekdayBar), next_page_token: null, currency: 'USD' }),
    },
    {
      method: 'GET',
      pattern: '/v1beta3/crypto/us/bars',
      handle: (request) => json({ bars: bars(request, () => true), next_page_token: null }),
    },
    {
      method: 'GET',
      pattern: '/v2/stocks/snapshots',
      handle: (request) => json(snapshots(request)),
    },
    {
      method: 'GET',
      pattern: '/v1beta3/crypto/us/snapshots',
      handle: (request) => json({ snapshots: snapshots(request) }),
    },
  ]
}

const screenerRoutes = (deps: DataDeps): Route[] => {
  const movers = (universe: string[], marketType: string, request: MockRequest): Response =>
    json({
      ...moversView(universe, deps.prices, topCount(request.query)),
      market_type: marketType,
      last_updated: deps.now().toISOString(),
    })
  return [
    {
      method: 'GET',
      pattern: '/v1beta1/screener/stocks/movers',
      handle: (request) => movers(STOCK_UNIVERSE, 'stocks', request),
    },
    {
      method: 'GET',
      pattern: '/v1beta1/screener/crypto/movers',
      handle: (request) => movers(CRYPTO_UNIVERSE, 'crypto', request),
    },
    {
      method: 'GET',
      pattern: '/v1beta1/screener/stocks/most-actives',
      handle: (request) =>
        json({
          most_actives: mostActivesView(STOCK_UNIVERSE, topCount(request.query)),
          last_updated: deps.now().toISOString(),
        }),
    },
  ]
}

export function createData(deps: DataDeps): Handler {
  const routes = [
    ...tradeRoutes(deps),
    ...optionRoutes(deps),
    ...barRoutes(deps),
    ...screenerRoutes(deps),
  ]
  return (request) => dispatch(routes, request, notFound)
}

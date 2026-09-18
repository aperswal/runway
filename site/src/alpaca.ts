import { z } from 'zod'
import {
  accountSchema,
  assetSchema,
  clockSchema,
  contractSchema,
  latestTradesSchema,
  newsSchema,
  orderSchema,
  positionSchema,
  type Account,
  type Asset,
  type Clock,
  type Headline,
  type Order,
  type Position,
} from './alpaca-schemas'
import { ExternalServiceError } from './errors'
import {
  extendedHours,
  isCrypto,
  isOption,
  isTerminalOrder,
  positionSymbol,
  timeInForce,
  type BuyOrder,
} from './symbols'

export type { Account, Asset, Clock, Headline, Order, Position } from './alpaca-schemas'
export type AlpacaUrls = { trading: string; data: string }

export const PAPER_TRADING_URL = 'https://paper-api.alpaca.markets'
export const LIVE_TRADING_URL = 'https://api.alpaca.markets'
export const DATA_URL = 'https://data.alpaca.markets'

const FILL_ATTEMPTS = 20
const FILL_INTERVAL_MS = 500
const MS_PER_SECOND = 1000
const CENTS = 2

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export class Alpaca {
  private readonly key: string
  private readonly secret: string
  private readonly urls: AlpacaUrls

  constructor(key: string, secret: string, urls: AlpacaUrls) {
    this.key = key
    this.secret = secret
    this.urls = urls
  }

  account(): Promise<Account> {
    return this.call(this.urls.trading, '/v2/account', accountSchema)
  }

  positions(): Promise<Position[]> {
    return this.call(this.urls.trading, '/v2/positions', z.array(positionSchema))
  }

  clock(): Promise<Clock> {
    return this.call(this.urls.trading, '/v2/clock', clockSchema)
  }

  async asset(symbol: string): Promise<Asset> {
    if (!isOption(symbol)) {
      return this.call(this.urls.trading, `/v2/assets/${encodeURIComponent(symbol)}`, assetSchema)
    }
    const path = `/v2/options/contracts/${encodeURIComponent(symbol)}`
    const contract = await this.call(this.urls.trading, path, contractSchema)
    return { ...contract, class: 'us_option', fractionable: false }
  }

  optionContracts(search: string): Promise<string> {
    return this.raw(`/v2/options/contracts${search}`, {})
  }

  private async raw(path: string, init: RequestInit): Promise<string> {
    const res = await fetch(this.urls.trading + path, { ...init, headers: this.headers() })
    const body = await res.text()
    if (!res.ok) {
      throw new ExternalServiceError(
        'alpaca',
        res.status,
        `${new URL(this.urls.trading + path).pathname}: ${body}`,
      )
    }
    return body
  }

  order(id: string): Promise<Order> {
    return this.call(this.urls.trading, `/v2/orders/${encodeURIComponent(id)}`, orderSchema)
  }

  buy(order: BuyOrder): Promise<Order> {
    const amount =
      order.qty === undefined
        ? { notional: order.notional.toFixed(CENTS) }
        : { qty: String(order.qty) }
    const limit = order.limit === null ? {} : { limit_price: order.limit.toFixed(CENTS) }
    return this.call(this.urls.trading, '/v2/orders', orderSchema, {
      method: 'POST',
      body: JSON.stringify({
        symbol: order.symbol,
        ...amount,
        ...limit,
        side: 'buy',
        type: order.limit === null ? 'market' : 'limit',
        time_in_force: timeInForce(order.symbol),
        extended_hours: extendedHours(order),
      }),
    })
  }

  async cancelOrder(id: string): Promise<void> {
    await this.raw(`/v2/orders/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  sell(symbol: string, qty: number, limit: number | null): Promise<Order> {
    const pricing =
      limit === null
        ? { type: 'market', time_in_force: timeInForce(symbol), extended_hours: false }
        : {
            type: 'limit',
            limit_price: limit.toFixed(CENTS),
            time_in_force: 'day',
            extended_hours: true,
          }
    return this.call(this.urls.trading, '/v2/orders', orderSchema, {
      method: 'POST',
      body: JSON.stringify({ symbol, qty: String(qty), side: 'sell', ...pricing }),
    })
  }

  closePosition(symbol: string): Promise<Order> {
    const path = `/v2/positions/${encodeURIComponent(positionSymbol(symbol))}`
    return this.call(this.urls.trading, path, orderSchema, { method: 'DELETE' })
  }

  async waitForFill(id: string, known?: Order): Promise<Order> {
    let order = known
    for (let attempt = 0; attempt < FILL_ATTEMPTS; attempt += 1) {
      order ??= await this.order(id)
      if (order.status === 'filled') {
        return order
      }
      if (isTerminalOrder(order.status)) {
        throw new ExternalServiceError('alpaca', 0, `order ${id} ${order.status}`)
      }
      order = undefined
      await sleep(FILL_INTERVAL_MS)
    }
    const waited = (FILL_ATTEMPTS * FILL_INTERVAL_MS) / MS_PER_SECOND
    throw new ExternalServiceError('alpaca', 0, `order ${id} not filled after ${waited}s`)
  }

  async latestPrices(symbols: string[]): Promise<Record<string, number>> {
    const groups: [string[], string][] = [
      [
        symbols.filter((s) => !isCrypto(s) && !isOption(s)),
        '/v2/stocks/trades/latest?feed=iex&symbols=',
      ],
      [symbols.filter(isCrypto), '/v1beta3/crypto/us/latest/trades?symbols='],
      [symbols.filter(isOption), '/v1beta1/options/trades/latest?symbols='],
    ]
    const fetched = await Promise.all(
      groups
        .filter(([list]) => list.length > 0)
        .map(([list, path]) => this.prices(`${path}${encodeURIComponent(list.join(','))}`)),
    )
    return Object.assign({}, ...fetched) as Record<string, number>
  }

  async news(symbols: string[], limit: number): Promise<Headline[]> {
    const query = new URLSearchParams({ limit: String(limit) })
    if (symbols.length > 0) {
      query.set('symbols', symbols.join(','))
    }
    const { news } = await this.call(
      this.urls.data,
      `/v1beta1/news?${query.toString()}`,
      newsSchema,
    )
    return news
  }

  proxyData(path: string): Promise<Response> {
    return fetch(this.urls.data + path, { headers: this.headers() })
  }

  private async prices(path: string): Promise<Record<string, number>> {
    const { trades } = await this.call(this.urls.data, path, latestTradesSchema)
    return Object.fromEntries(Object.entries(trades).map(([symbol, trade]) => [symbol, trade.p]))
  }

  private headers(): Record<string, string> {
    return {
      'APCA-API-KEY-ID': this.key,
      'APCA-API-SECRET-KEY': this.secret,
      'content-type': 'application/json',
      accept: 'application/json',
    }
  }

  private async call<T>(
    base: string,
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const res = await fetch(base + path, { ...init, headers: this.headers() })
    const body = await res.text()
    if (!res.ok) {
      throw new ExternalServiceError('alpaca', res.status, `${path}: ${body}`)
    }
    const parsed = schema.safeParse(JSON.parse(body))
    if (!parsed.success) {
      throw new ExternalServiceError(
        'alpaca',
        res.status,
        `${path}: unexpected shape: ${parsed.error.message}`,
      )
    }
    return parsed.data
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ALPACA,
  DATA,
  accountJson,
  assetJson,
  clockJson,
  headerOf,
  headlineJson,
  jsonBody,
  latestTradesJson,
  orderJson,
  positionJson,
  stubFetch,
} from '../test/helpers'
import { Alpaca } from './alpaca'
import {
  contractMultiplier,
  isCrypto,
  isOption,
  isTerminalOrder,
  isWholeShares,
  positionSymbol,
  timeInForce,
  extendedHours,
} from './symbols'
import { ExternalServiceError } from './errors'

const alpaca = new Alpaca('key', 'secret', { trading: ALPACA, data: DATA })

describe('symbol helpers', () => {
  it('detects option contracts and their multiplier', () => {
    expect(isOption('AAPL260116C00190000')).toBe(true)
    expect(isOption('AAPL')).toBe(false)
    expect(isOption('BTC/USD')).toBe(false)
    expect(isOption('AAPLXYZ260116C00190000')).toBe(false)
    expect(isOption('AAPL260116C001900001')).toBe(false)
    expect(contractMultiplier('AAPL260116C00190000')).toBe(100)
    expect(contractMultiplier('AAPL')).toBe(1)
    expect(timeInForce('AAPL260116C00190000')).toBe('day')
    expect(extendedHours({ symbol: 'AAPL260116C00190000', qty: 1, limit: 2 })).toBe(false)
  })
  it('detects crypto pairs', () => {
    expect(isCrypto('BTC/USD')).toBe(true)
    expect(isCrypto('AAPL')).toBe(false)
  })
  it('strips the slash for position lookups', () => {
    expect(positionSymbol('BTC/USD')).toBe('BTCUSD')
  })
  it('knows terminal order statuses', () => {
    expect(isTerminalOrder('canceled')).toBe(true)
    expect(isTerminalOrder('new')).toBe(false)
  })
})

describe('Alpaca', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('reads the account and defaults nullable fields', async () => {
    const { calls } = stubFetch([
      {
        url: `${ALPACA}/v2/account`,
        body: accountJson({ daytradeCount: null, patternDayTrader: null }),
      },
    ])
    expect(await alpaca.account()).toEqual({
      equity: 1000,
      cash: 800,
      daytrade_count: 0,
      pattern_day_trader: false,
    })
    expect(headerOf(calls[0], 'APCA-API-KEY-ID')).toBe('key')
    expect(headerOf(calls[0], 'APCA-API-SECRET-KEY')).toBe('secret')
    expect(headerOf(calls[0], 'accept')).toBe('application/json')
    expect(headerOf(calls[0], 'content-type')).toBe('application/json')
  })

  it('defaults day trade fields the paper api omits', async () => {
    stubFetch([{ url: `${ALPACA}/v2/account`, body: { equity: '1', cash: '1' } }])
    const account = await alpaca.account()
    expect(account.daytrade_count).toBe(0)
    expect(account.pattern_day_trader).toBe(false)
  })

  it('keeps day trade counts when present', async () => {
    stubFetch([
      {
        url: `${ALPACA}/v2/account`,
        body: accountJson({ daytradeCount: 2, patternDayTrader: true }),
      },
    ])
    const account = await alpaca.account()
    expect(account.daytrade_count).toBe(2)
    expect(account.pattern_day_trader).toBe(true)
  })

  it('lists stock and crypto positions', async () => {
    stubFetch([
      {
        url: `${ALPACA}/v2/positions`,
        body: [positionJson(), positionJson({ symbol: 'BTCUSD', assetClass: 'crypto' })],
      },
    ])
    expect(await alpaca.positions()).toEqual([
      {
        symbol: 'AAPL',
        qty: 0.5,
        avg_entry_price: 200,
        current_price: 210,
        market_value: 105,
        unrealized_pl: 5,
        asset_class: 'us_equity',
      },
      expect.objectContaining({ symbol: 'BTCUSD', asset_class: 'crypto' }),
    ])
  })

  it('reads the clock', async () => {
    stubFetch([{ url: `${ALPACA}/v2/clock`, body: clockJson(false) }])
    expect((await alpaca.clock()).is_open).toBe(false)
  })

  it('encodes the asset symbol', async () => {
    const { calls } = stubFetch([
      {
        url: `${ALPACA}/v2/assets/BTC%2FUSD`,
        body: assetJson({ symbol: 'BTC/USD', class: 'crypto' }),
      },
    ])
    expect((await alpaca.asset('BTC/USD')).class).toBe('crypto')
    expect(calls).toHaveLength(1)
  })

  it('reads an order', async () => {
    stubFetch([{ url: `${ALPACA}/v2/orders/ord-1`, body: orderJson() }])
    expect(await alpaca.order('ord-1')).toEqual({
      id: 'ord-1',
      symbol: 'AAPL',
      status: 'filled',
      filled_avg_price: 200,
      filled_qty: 0.5,
    })
  })

  it('submits a day market buy for stocks', async () => {
    const { calls } = stubFetch([{ url: `${ALPACA}/v2/orders`, method: 'POST', body: orderJson() }])
    await alpaca.buy({ symbol: 'AAPL', notional: 12.345, limit: null })
    expect(jsonBody(calls[0])).toEqual({
      symbol: 'AAPL',
      notional: '12.35',
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      extended_hours: false,
    })
  })

  it('submits a gtc market buy for crypto', async () => {
    const { calls } = stubFetch([{ url: `${ALPACA}/v2/orders`, method: 'POST', body: orderJson() }])
    await alpaca.buy({ symbol: 'BTC/USD', notional: 10, limit: null })
    expect(jsonBody(calls[0]).time_in_force).toBe('gtc')
  })

  it('submits qty and limit orders with the right time in force', async () => {
    const { calls } = stubFetch([{ url: `${ALPACA}/v2/orders`, method: 'POST', body: orderJson() }])
    await alpaca.buy({ symbol: 'AAPL', qty: 2, limit: 95.5 })
    expect(jsonBody(calls[0])).toEqual({
      symbol: 'AAPL',
      qty: '2',
      limit_price: '95.50',
      side: 'buy',
      type: 'limit',
      time_in_force: 'day',
      extended_hours: true,
    })
    await alpaca.buy({ symbol: 'AAPL', qty: 1.5, limit: 95 })
    expect(jsonBody(calls[1])).toMatchObject({ qty: '1.5', type: 'limit', extended_hours: false })
    await alpaca.buy({ symbol: 'AAPL', qty: 3, limit: null })
    expect(jsonBody(calls[2])).toEqual({
      symbol: 'AAPL',
      qty: '3',
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      extended_hours: false,
    })
    await alpaca.buy({ symbol: 'BTC/USD', qty: 0.01, limit: 50000 })
    expect(jsonBody(calls[3])).toMatchObject({ time_in_force: 'gtc', extended_hours: false })
    expect(isWholeShares(2)).toBe(true)
    expect(isWholeShares(2.5)).toBe(false)
    expect(timeInForce('AAPL')).toBe('day')
    expect(timeInForce('BTC/USD')).toBe('gtc')
    expect(extendedHours({ symbol: 'AAPL', qty: 2, limit: 1 })).toBe(true)
    expect(extendedHours({ symbol: 'AAPL', qty: 2, limit: null })).toBe(false)
    expect(extendedHours({ symbol: 'AAPL', notional: 5, limit: null })).toBe(false)
  })

  it('cancels an order and surfaces failures', async () => {
    const { calls } = stubFetch([
      { url: `${ALPACA}/v2/orders/ord-1`, method: 'DELETE', status: 204, body: '' },
      { url: `${ALPACA}/v2/orders/ord-2`, method: 'DELETE', status: 422, body: 'not cancelable' },
    ])
    await alpaca.cancelOrder('ord-1')
    expect(calls[0]).toMatchObject({ method: 'DELETE' })
    expect(headerOf(calls[0], 'APCA-API-KEY-ID')).toBe('key')
    await expect(alpaca.cancelOrder('ord-2')).rejects.toThrow(
      'alpaca 422: /v2/orders/ord-2: not cancelable',
    )
  })

  it('reads option contracts as assets and proxies contract searches', async () => {
    const { calls } = stubFetch([
      {
        url: `${ALPACA}/v2/options/contracts/AAPL260116C00190000`,
        body: { symbol: 'AAPL260116C00190000', tradable: true, status: 'active', extra: 1 },
      },
      {
        url: `${ALPACA}/v2/options/contracts?underlying_symbols=AAPL`,
        body: '{"option_contracts":[]}',
      },
      { url: `${ALPACA}/v2/options/contracts?underlying_symbols=NOPE`, status: 422, body: 'bad' },
    ])
    expect(await alpaca.asset('AAPL260116C00190000')).toEqual({
      symbol: 'AAPL260116C00190000',
      tradable: true,
      status: 'active',
      class: 'us_option',
      fractionable: false,
    })
    expect(await alpaca.optionContracts('?underlying_symbols=AAPL')).toBe('{"option_contracts":[]}')
    expect(headerOf(calls[1], 'APCA-API-KEY-ID')).toBe('key')
    await expect(alpaca.optionContracts('?underlying_symbols=NOPE')).rejects.toThrow(
      'alpaca 422: /v2/options/contracts: bad',
    )
  })

  it('parses option assets and positions', async () => {
    stubFetch([
      {
        url: `${ALPACA}/v2/assets/OPT`,
        body: assetJson({ symbol: 'OPT', class: 'us_option', fractionable: false }),
      },
      { url: `${ALPACA}/v2/positions`, body: [positionJson({ assetClass: 'us_option' })] },
    ])
    expect((await alpaca.asset('OPT')).class).toBe('us_option')
    expect((await alpaca.positions())[0]?.asset_class).toBe('us_option')
  })

  it('prices options through the options feed', async () => {
    const { calls } = stubFetch([
      {
        url: `${DATA}/v1beta1/options/trades/latest?symbols=AAPL260116C00190000`,
        body: latestTradesJson({ AAPL260116C00190000: 4.2 }),
      },
      {
        url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`,
        body: latestTradesJson({ AAPL: 200 }),
      },
    ])
    expect(await alpaca.latestPrices(['AAPL', 'AAPL260116C00190000'])).toEqual({
      AAPL: 200,
      AAPL260116C00190000: 4.2,
    })
    expect(calls).toHaveLength(2)
    expect(await alpaca.latestPrices([])).toEqual({})
  })

  it('sells a quantity with an extended-hours limit day order', async () => {
    const { calls } = stubFetch([{ url: `${ALPACA}/v2/orders`, method: 'POST', body: orderJson() }])
    await alpaca.sell('AAPL', 2, 208.95)
    expect(jsonBody(calls[0])).toEqual({
      symbol: 'AAPL',
      qty: '2',
      side: 'sell',
      type: 'limit',
      limit_price: '208.95',
      time_in_force: 'day',
      extended_hours: true,
    })
  })

  it('sells a quantity at market with the venue time in force', async () => {
    const { calls } = stubFetch([{ url: `${ALPACA}/v2/orders`, method: 'POST', body: orderJson() }])
    await alpaca.sell('AAPL', 0.4, null)
    expect(jsonBody(calls[0])).toEqual({
      symbol: 'AAPL',
      qty: '0.4',
      side: 'sell',
      type: 'market',
      time_in_force: 'day',
      extended_hours: false,
    })
    await alpaca.sell('BTC/USD', 0.01, null)
    expect(jsonBody(calls[1])).toMatchObject({ symbol: 'BTC/USD', time_in_force: 'gtc' })
  })

  it('closes a position by its broker symbol', async () => {
    const { calls } = stubFetch([
      {
        url: `${ALPACA}/v2/positions/BTCUSD`,
        method: 'DELETE',
        body: orderJson({ symbol: 'BTCUSD' }),
      },
    ])
    expect((await alpaca.closePosition('BTC/USD')).symbol).toBe('BTCUSD')
    expect(calls[0]?.method).toBe('DELETE')
  })

  it('waits for a fill', async () => {
    vi.useFakeTimers()
    const { calls } = stubFetch([
      { url: `${ALPACA}/v2/orders/ord-1`, body: orderJson({ status: 'new' }), times: 2 },
      { url: `${ALPACA}/v2/orders/ord-1`, body: orderJson() },
    ])
    const pending = alpaca.waitForFill('ord-1')
    await vi.advanceTimersByTimeAsync(600)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    expect((await pending).status).toBe('filled')
    expect(calls).toHaveLength(3)
  })

  it('skips the fetch entirely when the known order already filled', async () => {
    const { calls } = stubFetch([])
    const known = {
      id: 'ord-1',
      symbol: 'AAPL',
      status: 'filled',
      filled_avg_price: 200,
      filled_qty: 1,
    }
    expect(await alpaca.waitForFill('ord-1', known)).toEqual(known)
    expect(calls).toHaveLength(0)
  })

  it('reuses a known order for the first check before polling', async () => {
    vi.useFakeTimers()
    const { calls } = stubFetch([{ url: `${ALPACA}/v2/orders/ord-1`, body: orderJson() }])
    const known = {
      id: 'ord-1',
      symbol: 'AAPL',
      status: 'new',
      filled_avg_price: null,
      filled_qty: null,
    }
    const pending = alpaca.waitForFill('ord-1', known)
    expect(calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(500)
    expect((await pending).status).toBe('filled')
    expect(calls).toHaveLength(1)
  })

  it('fails fast on a terminal order', async () => {
    stubFetch([{ url: `${ALPACA}/v2/orders/ord-1`, body: orderJson({ status: 'canceled' }) }])
    await expect(alpaca.waitForFill('ord-1')).rejects.toThrow('alpaca 0: order ord-1 canceled')
  })

  it('gives up after the fill window', async () => {
    vi.useFakeTimers()
    const { calls } = stubFetch([
      { url: `${ALPACA}/v2/orders/ord-1`, body: orderJson({ status: 'new' }) },
    ])
    const outcome = alpaca.waitForFill('ord-1').catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10_500)
    const error = await outcome
    expect(error).toBeInstanceOf(ExternalServiceError)
    expect((error as Error).message).toBe('alpaca 0: order ord-1 not filled after 10s')
    expect(calls).toHaveLength(20)
  })

  it('fetches latest prices for stocks and crypto separately', async () => {
    const { calls } = stubFetch([
      {
        url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL%2CMSFT`,
        body: latestTradesJson({ AAPL: 210, MSFT: 400 }),
      },
      {
        url: `${DATA}/v1beta3/crypto/us/latest/trades?symbols=BTC%2FUSD`,
        body: latestTradesJson({ 'BTC/USD': 60000 }),
      },
    ])
    expect(await alpaca.latestPrices(['AAPL', 'BTC/USD', 'MSFT'])).toEqual({
      AAPL: 210,
      MSFT: 400,
      'BTC/USD': 60000,
    })
    expect(calls).toHaveLength(2)
  })

  it('skips the crypto call when only stocks are asked for', async () => {
    const { calls } = stubFetch([
      {
        url: `${DATA}/v2/stocks/trades/latest?feed=iex&symbols=AAPL`,
        body: latestTradesJson({ AAPL: 1 }),
      },
    ])
    expect(await alpaca.latestPrices(['AAPL'])).toEqual({ AAPL: 1 })
    expect(calls).toHaveLength(1)
  })

  it('skips the stock call when only crypto is asked for', async () => {
    const { calls } = stubFetch([
      {
        url: `${DATA}/v1beta3/crypto/us/latest/trades?symbols=ETH%2FUSD`,
        body: latestTradesJson({ 'ETH/USD': 2 }),
      },
    ])
    expect(await alpaca.latestPrices(['ETH/USD'])).toEqual({ 'ETH/USD': 2 })
    expect(calls).toHaveLength(1)
  })

  it('joins several crypto symbols with a comma', async () => {
    const { calls } = stubFetch([
      {
        url: `${DATA}/v1beta3/crypto/us/latest/trades?symbols=BTC%2FUSD%2CETH%2FUSD`,
        body: latestTradesJson({ 'BTC/USD': 1, 'ETH/USD': 2 }),
      },
    ])
    expect(await alpaca.latestPrices(['BTC/USD', 'ETH/USD'])).toEqual({
      'BTC/USD': 1,
      'ETH/USD': 2,
    })
    expect(calls).toHaveLength(1)
  })

  it('makes no call without symbols', async () => {
    const { calls } = stubFetch([])
    expect(await alpaca.latestPrices([])).toEqual({})
    expect(calls).toHaveLength(0)
  })

  it('fetches news for symbols', async () => {
    const { calls } = stubFetch([
      { url: `${DATA}/v1beta1/news?limit=5&symbols=AAPL%2CMSFT`, body: { news: [headlineJson()] } },
    ])
    const news = await alpaca.news(['AAPL', 'MSFT'], 5)
    expect(news[0]?.headline).toBe('Apple beats')
    expect(calls).toHaveLength(1)
  })

  it('fetches general news without symbols', async () => {
    const { calls } = stubFetch([{ url: `${DATA}/v1beta1/news?limit=10`, body: { news: [] } }])
    expect(await alpaca.news([], 10)).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('proxies data requests with auth headers', async () => {
    const { calls } = stubFetch([
      { url: `${DATA}/v2/stocks/bars?symbols=AAPL`, body: '{"bars":{}}' },
    ])
    const res = await alpaca.proxyData('/v2/stocks/bars?symbols=AAPL')
    expect(await res.text()).toBe('{"bars":{}}')
    expect(headerOf(calls[0], 'APCA-API-KEY-ID')).toBe('key')
  })

  it('raises an external error on non-2xx responses', async () => {
    stubFetch([{ url: `${ALPACA}/v2/account`, status: 401, body: '{"message":"unauthorized"}' }])
    await expect(alpaca.account()).rejects.toThrow(
      'alpaca 401: /v2/account: {"message":"unauthorized"}',
    )
  })

  it('raises an external error on an unexpected shape', async () => {
    stubFetch([{ url: `${ALPACA}/v2/clock`, body: { is_open: 'yes' } }])
    const error = await alpaca.clock().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ExternalServiceError)
    expect((error as ExternalServiceError).status).toBe(200)
    expect((error as ExternalServiceError).service).toBe('alpaca')
    expect((error as Error).message).toMatch(/^alpaca 200: \/v2\/clock: unexpected shape: /)
  })
})

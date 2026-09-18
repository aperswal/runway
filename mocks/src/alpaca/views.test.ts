import { describe, expect, it } from 'vitest'
import { PriceFeed } from './prices.ts'
import { AlpacaState } from './state.ts'
import { accountView, assetView, orderView, positionView } from './views.ts'

const NOW = '2026-09-01T15:00:00.000Z'
const AAPL_ID = '58cd330b-0000-4000-8000-58cd330b58cd'
const BTC_ID = 'f83d64ef-0000-4000-8000-f83d64eff83d'

describe('accountView', () => {
  it('renders the fresh account with string money', () => {
    const state = new AlpacaState(1000, new PriceFeed(), () => new Date(NOW))
    expect(accountView(state, NOW)).toEqual({
      id: 'mock-account',
      account_number: 'MOCK000001',
      status: 'ACTIVE',
      crypto_status: 'ACTIVE',
      currency: 'USD',
      buying_power: '1000.00',
      regt_buying_power: '1000.00',
      daytrading_buying_power: '0',
      non_marginable_buying_power: '1000.00',
      cash: '1000.00',
      accrued_fees: '0',
      pending_transfer_in: '0',
      portfolio_value: '1000.00',
      pattern_day_trader: false,
      trading_blocked: false,
      transfers_blocked: false,
      account_blocked: false,
      created_at: NOW,
      trade_suspended_by_user: false,
      multiplier: '1',
      shorting_enabled: false,
      equity: '1000.00',
      last_equity: '1000.00',
      long_market_value: '0.00',
      short_market_value: '0',
      initial_margin: '0',
      maintenance_margin: '0',
      last_maintenance_margin: '0',
      sma: '0',
      daytrade_count: 0,
    })
  })

  it('reflects cash, market value and equity after a buy', () => {
    const state = new AlpacaState(1000, new PriceFeed(), () => new Date(NOW))
    state.prices.set('AAPL', 100)
    state.submit({
      symbol: 'AAPL',
      side: 'buy',
      limitPrice: null,
      amount: { kind: 'qty', qty: 2 },
      timeInForce: 'day',
    })
    state.prices.set('AAPL', 110)
    const cash = state.cash.toFixed(2)
    expect(cash).not.toBe('1000.00')
    const view = accountView(state, NOW)
    expect(view).toMatchObject({
      cash,
      buying_power: cash,
      regt_buying_power: cash,
      non_marginable_buying_power: cash,
      last_equity: '1000.00',
    })
    expect(Math.abs(Number(view.long_market_value) - 220)).toBeLessThan(3)
    expect(Math.abs(Number(view.equity) - 1020)).toBeLessThan(3)
    expect(view.portfolio_value).toBe(view.equity)
  })
})

describe('positionView', () => {
  it('renders a stock position with gains', () => {
    expect(positionView({ symbol: 'AAPL', qty: 2, avgEntryPrice: 100 }, 110)).toEqual({
      asset_id: AAPL_ID,
      symbol: 'AAPL',
      exchange: 'NASDAQ',
      asset_class: 'us_equity',
      asset_marginable: false,
      qty: '2',
      avg_entry_price: '100',
      side: 'long',
      market_value: '220.00',
      cost_basis: '200.00',
      unrealized_pl: '20.00',
      unrealized_plpc: '0.1',
      unrealized_intraday_pl: '20.00',
      unrealized_intraday_plpc: '0.1',
      current_price: '110.00',
      lastday_price: '100',
      change_today: '0.1',
      qty_available: '2',
    })
  })

  it('renders a crypto position with losses', () => {
    expect(positionView({ symbol: 'BTC/USD', qty: 0.5, avgEntryPrice: 50 }, 40)).toEqual({
      asset_id: BTC_ID,
      symbol: 'BTCUSD',
      exchange: 'CRYPTO',
      asset_class: 'crypto',
      asset_marginable: false,
      qty: '0.5',
      avg_entry_price: '50',
      side: 'long',
      market_value: '20.00',
      cost_basis: '25.00',
      unrealized_pl: '-5.00',
      unrealized_plpc: '-0.2',
      unrealized_intraday_pl: '-5.00',
      unrealized_intraday_plpc: '-0.2',
      current_price: '40.00',
      lastday_price: '50',
      change_today: '-0.2',
      qty_available: '0.5',
    })
  })

  it('rounds quantities to nine places', () => {
    const view = positionView({ symbol: 'AAPL', qty: 1 / 3, avgEntryPrice: 100 }, 100)
    expect(view.qty).toBe('0.333333333')
  })
})

describe('orderView', () => {
  it('renders a filled qty order', () => {
    expect(
      orderView({
        id: 'id1',
        symbol: 'AAPL',
        assetClass: 'us_equity',
        side: 'buy',
        qty: 2,
        notional: null,
        filledAvgPrice: 100,
        limitPrice: null,
        status: 'filled',
        timeInForce: 'day',
        createdAt: NOW,
      }),
    ).toEqual({
      id: 'id1',
      client_order_id: 'id1',
      created_at: NOW,
      updated_at: NOW,
      submitted_at: NOW,
      filled_at: NOW,
      expired_at: null,
      canceled_at: null,
      failed_at: null,
      replaced_at: null,
      replaced_by: null,
      replaces: null,
      asset_id: AAPL_ID,
      symbol: 'AAPL',
      asset_class: 'us_equity',
      notional: null,
      qty: '2',
      filled_qty: '2',
      filled_avg_price: '100.00',
      order_class: 'simple',
      order_type: 'market',
      type: 'market',
      side: 'buy',
      time_in_force: 'day',
      limit_price: null,
      stop_price: null,
      status: 'filled',
      extended_hours: false,
      legs: null,
      trail_percent: null,
      trail_price: null,
      hwm: null,
    })
  })

  it('renders notional orders with the notional and no qty', () => {
    const view = orderView({
      id: 'id2',
      symbol: 'BTC/USD',
      assetClass: 'crypto',
      side: 'sell',
      qty: 0.25,
      notional: 12.5,
      filledAvgPrice: 50,
      limitPrice: null,
      status: 'filled',
      timeInForce: 'gtc',
      createdAt: NOW,
    })
    expect(view).toMatchObject({
      asset_id: BTC_ID,
      notional: '12.50',
      qty: null,
      filled_qty: '0.25',
      filled_avg_price: '50.00',
      side: 'sell',
      time_in_force: 'gtc',
    })
  })

  it('renders queued limit orders without fills', () => {
    const view = orderView({
      id: 'id3',
      symbol: 'AAPL',
      assetClass: 'us_equity',
      side: 'buy',
      qty: 3,
      notional: null,
      filledAvgPrice: null,
      limitPrice: 95.5,
      status: 'new',
      timeInForce: 'gtc',
      createdAt: NOW,
    })
    expect(view).toMatchObject({
      qty: '3',
      filled_qty: '0',
      filled_avg_price: null,
      filled_at: null,
      order_type: 'limit',
      type: 'limit',
      limit_price: '95.50',
      status: 'new',
    })
  })
})

describe('assetView', () => {
  it('describes a stock', () => {
    expect(assetView('AAPL')).toEqual({
      id: AAPL_ID,
      class: 'us_equity',
      exchange: 'NASDAQ',
      symbol: 'AAPL',
      name: 'AAPL (mock)',
      status: 'active',
      tradable: true,
      marginable: true,
      shortable: false,
      easy_to_borrow: false,
      fractionable: true,
      maintenance_margin_requirement: 100,
      attributes: [],
    })
  })

  it('describes crypto from any spelling', () => {
    expect(assetView('btcusd')).toEqual({
      id: BTC_ID,
      class: 'crypto',
      exchange: 'CRYPTO',
      symbol: 'BTC/USD',
      name: 'BTC/USD (mock)',
      status: 'active',
      tradable: true,
      marginable: false,
      shortable: false,
      easy_to_borrow: false,
      fractionable: true,
      maintenance_margin_requirement: 100,
      attributes: [],
    })
  })

  it('zero pads short hashes into the uuid', () => {
    expect(assetView('BCO').id).toBe('00731647-0000-4000-8000-007316470073')
  })
})

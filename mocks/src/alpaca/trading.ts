import { z } from 'zod'
import { AlpacaNotFoundError, AlpacaUnprocessableError, STATUS, issueMessages } from '../errors.ts'
import {
  dispatch,
  empty,
  json,
  param,
  type Handler,
  type MockRequest,
  type Route,
} from '../http.ts'
import { marketClock } from './clock.ts'
import type { AlpacaState, OrderAmount, OrderRequest } from './state.ts'
import { contractView, parseContract, searchContracts } from './options.ts'
import { accountView, assetView, orderView, positionView } from './views.ts'

export type TradingDeps = {
  state: AlpacaState
  now: () => Date
  marketOpen: boolean | undefined
}

const orderSchema = z.object({
  symbol: z.string().min(1),
  qty: z.coerce.number().positive().optional(),
  notional: z.coerce.number().positive().optional(),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']),
  limit_price: z.coerce.number().positive().optional(),
  extended_hours: z.boolean().optional(),
  time_in_force: z.enum(['day', 'gtc', 'ioc', 'fok', 'opg', 'cls']),
})

export function parseOrder(body: unknown): OrderRequest {
  const parsed = orderSchema.safeParse(body)
  if (!parsed.success) {
    throw new AlpacaUnprocessableError(issueMessages(parsed.error.issues))
  }
  const { symbol, side, time_in_force: timeInForce, type, limit_price: limitPrice } = parsed.data
  if ((type === 'limit') !== (limitPrice !== undefined)) {
    throw new AlpacaUnprocessableError(
      'limit orders need limit_price; market orders must not have one',
    )
  }
  if (type === 'limit' && parsed.data.qty === undefined) {
    throw new AlpacaUnprocessableError('limit orders need qty')
  }
  return {
    symbol,
    side,
    timeInForce,
    amount: orderAmount(parsed.data),
    limitPrice: limitPrice ?? null,
  }
}

function orderAmount(input: {
  qty?: number | undefined
  notional?: number | undefined
}): OrderAmount {
  if (input.qty !== undefined && input.notional === undefined) {
    return { kind: 'qty', qty: input.qty }
  }
  if (input.notional !== undefined && input.qty === undefined) {
    return { kind: 'notional', notional: input.notional }
  }
  throw new AlpacaUnprocessableError('exactly one of qty or notional is required')
}

const notFound = (): never => {
  throw new AlpacaNotFoundError('endpoint not found')
}

const optionRoutes = (deps: TradingDeps): Route[] => {
  const { state } = deps
  return [
    {
      method: 'GET',
      pattern: '/v2/options/contracts',
      handle: (request) =>
        json({
          option_contracts: searchContracts(request, deps.now()).map((c) =>
            contractView(c, state.prices),
          ),
          next_page_token: null,
        }),
    },
    {
      method: 'GET',
      pattern: '/v2/options/contracts/:symbol',
      handle: (_request, params) =>
        json(contractView(parseContract(param(params, 'symbol')), state.prices)),
    },
  ]
}

const orderRoutes = (state: AlpacaState): Route[] => [
  {
    method: 'POST',
    pattern: '/v2/orders',
    handle: (request: MockRequest) => json(orderView(state.submit(parseOrder(request.body)))),
  },
  { method: 'GET', pattern: '/v2/orders', handle: () => json(state.orders.map(orderView)) },
  {
    method: 'GET',
    pattern: '/v2/orders/:id',
    handle: (_request, params) => json(orderView(state.order(param(params, 'id')))),
  },
  {
    method: 'DELETE',
    pattern: '/v2/orders/:id',
    handle: (_request, params) => {
      state.cancel(param(params, 'id'))
      return empty(STATUS.noContent)
    },
  },
]

export function createTrading(deps: TradingDeps): Handler {
  const { state } = deps
  const createdAt = deps.now().toISOString()
  const routes: Route[] = [
    { method: 'GET', pattern: '/v2/account', handle: () => json(accountView(state, createdAt)) },
    {
      method: 'GET',
      pattern: '/v2/positions',
      handle: () =>
        json(
          [...state.positions.values()].map((p) => positionView(p, state.prices.current(p.symbol))),
        ),
    },
    {
      method: 'DELETE',
      pattern: '/v2/positions/:symbol',
      handle: (_request, params) => json(orderView(state.closePosition(param(params, 'symbol')))),
    },
    {
      method: 'GET',
      pattern: '/v2/clock',
      handle: () => json(marketClock(deps.now(), deps.marketOpen)),
    },
    {
      method: 'GET',
      pattern: '/v2/assets/:symbol',
      handle: (_request, params) => json(assetView(param(params, 'symbol'))),
    },
    ...optionRoutes(deps),
    ...orderRoutes(state),
  ]
  return (request) => dispatch(routes, request, notFound)
}

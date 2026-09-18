import { z } from 'zod'
import type { AlpacaState } from './alpaca/state.ts'
import { orderView, positionView } from './alpaca/views.ts'
import { canonicalSymbol } from './alpaca/prices.ts'
import { ApiError, STATUS, issueDetail } from './errors.ts'
import { dispatch, json, type Handler, type Route } from './http.ts'
import type { PostStore } from './posts.ts'

export type ControlDeps = { state: AlpacaState; posts: PostStore }

const MIN_PRICE = 0.01

const priceSchema = z.object({ symbol: z.string().min(1), price: z.number().min(MIN_PRICE) })

const NOT_FOUND_MESSAGE = 'unknown control endpoint'

const notFound = (): never => {
  throw new ApiError(STATUS.notFound, { message: NOT_FOUND_MESSAGE }, NOT_FOUND_MESSAGE)
}

export function createControl(deps: ControlDeps): Handler {
  const { state, posts } = deps
  const routes: Route[] = [
    {
      method: 'POST',
      pattern: '/price',
      handle: (request) => {
        const parsed = priceSchema.safeParse(request.body)
        if (!parsed.success) {
          const detail = issueDetail(parsed.error.issues)
          throw new ApiError(STATUS.badRequest, { message: detail }, detail)
        }
        state.prices.set(parsed.data.symbol, parsed.data.price)
        return json({ symbol: canonicalSymbol(parsed.data.symbol), price: parsed.data.price })
      },
    },
    {
      method: 'POST',
      pattern: '/reset',
      handle: () => {
        state.reset()
        posts.reset()
        return json({ ok: true })
      },
    },
    {
      method: 'GET',
      pattern: '/state',
      handle: () =>
        json({
          cash: state.cash,
          equity: state.equity(),
          positions: [...state.positions.values()].map((p) =>
            positionView(p, state.prices.current(p.symbol)),
          ),
          orders: state.orders.map(orderView),
          prices: state.prices.snapshot(),
          posts: posts.list(),
        }),
    },
    { method: 'GET', pattern: '/posts', handle: () => json(posts.list()) },
  ]
  return (request) => dispatch(routes, request, notFound)
}

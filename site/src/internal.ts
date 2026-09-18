import { Hono } from 'hono'
import { z } from 'zod'
import { agentHealth, restartAgent, startAgentRun } from './agent-trigger'
import { codexAuthStatus, refreshCodexAuth, storeCodexAuth } from './codex-auth'
import { buildContext } from './context'
import { runs } from './db/schema'
import type { Deps } from './deps'
import type { Bindings } from './env'
import { parseBody } from './parse'
import {
  createFund,
  fundInput,
  listFunds,
  reallocateFund,
  retireFund,
  retireInput,
  shareInput,
} from './funds'
import { cancelJob, createJob, jobInput, jobsQuery, listJobs } from './jobs'
import { cancelQueued, findQueuedTrade, openPositionInput, openTrade } from './open-trade'
import { closePositionInput, closeTrade, findOpenTrade, requirePrice } from './trades'
import { adjustExits, adjustExitsInput } from './exit-adjust'
import { liquidateAll } from './liquidation'
import { managerReport, reportManager, startManager } from './manager-dispatch'
import { listTrades, tradeQuery } from './trade-history'

type Env = { Bindings: Bindings; Variables: { deps: Deps } }

const HTTP_CREATED = 201
const HTTP_ACCEPTED = 202

const runInput = z.object({
  trigger: z.string().min(1),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  turns: z.number().int().nonnegative(),
  summary: z.string(),
  error: z.string().nullable(),
})

const symbolParam = (raw: string): string => decodeURIComponent(raw).toUpperCase()

export const internal = new Hono<Env>()

internal.post('/liquidate', async (c) => c.json(await liquidateAll(c.var.deps)))

internal.get('/codex-auth', async (c) => c.json(await codexAuthStatus(c.var.deps.db)))

internal.post('/codex-auth', async (c) => {
  await storeCodexAuth(c.var.deps.db, await c.req.json())
  return c.json(await codexAuthStatus(c.var.deps.db), HTTP_CREATED)
})

internal.post('/codex-auth/refresh', async (c) => {
  await refreshCodexAuth(c.var.deps.db, new Date(), { force: true })
  return c.json(await codexAuthStatus(c.var.deps.db))
})

const managerRunInput = z.object({ trigger: z.string().min(1) })

internal.post('/managers/:fund/run', async (c) => {
  const input = parseBody(managerRunInput, await c.req.json())
  const deps = { db: c.var.deps.db, env: c.env }
  const key = await startManager(deps, c.req.param('fund'), input.trigger)
  return c.json({ key }, HTTP_ACCEPTED)
})

const managerReportInput = z.object({ key: z.string().min(1), outcome: z.unknown() })

internal.post('/managers/:fund/report', async (c) => {
  const input = parseBody(managerReportInput, await c.req.json())
  const deps = { db: c.var.deps.db, env: c.env }
  await reportManager(deps, c.req.param('fund'), input.key, input.outcome)
  return c.json({ ok: true })
})

internal.get('/managers/:fund/report', async (c) =>
  c.json(await managerReport(c.var.deps.db, c.req.param('fund'), c.req.query('key') ?? '')),
)

internal.get('/trades', async (c) =>
  c.json(await listTrades(c.var.deps.db, parseBody(tradeQuery, c.req.query()))),
)

internal.get('/context', async (c) => {
  const fund = c.req.query('fund')
  const scope = {
    trigger: c.req.query('trigger') ?? 'manual',
    ...(fund === undefined ? {} : { fund }),
  }
  return c.text(await buildContext(c.var.deps, new Date(), scope))
})

internal.get('/options/contracts', async (c) =>
  c.body(await c.var.deps.alpaca.optionContracts(new URL(c.req.url).search), undefined, {
    'content-type': 'application/json',
  }),
)

internal.post('/positions', async (c) => {
  const input = parseBody(openPositionInput, await c.req.json())
  return c.json(await openTrade(c.var.deps, input), HTTP_CREATED)
})

internal.delete('/positions/:symbol', async (c) => {
  const input = parseBody(closePositionInput, await c.req.json())
  const trade = await findOpenTrade(c.var.deps.db, symbolParam(c.req.param('symbol')), input.fund)
  const { alpaca } = c.var.deps
  const [account, clock, prices] = await Promise.all([
    alpaca.account(),
    alpaca.clock(),
    alpaca.latestPrices([trade.symbol]),
  ])
  const exit = {
    reason: input.reason,
    account,
    marketOpen: clock.is_open,
    price: requirePrice(prices, trade.symbol),
  }
  return c.json(await closeTrade(c.var.deps, trade, exit, input.fraction))
})

internal.delete('/orders/:symbol', async (c) => {
  const input = parseBody(closePositionInput, await c.req.json())
  const trade = await findQueuedTrade(c.var.deps.db, symbolParam(c.req.param('symbol')), input.fund)
  return c.json(await cancelQueued(c.var.deps, trade, input.reason))
})

internal.patch('/positions/:symbol', async (c) => {
  const input = parseBody(adjustExitsInput, await c.req.json())
  const trade = await findOpenTrade(c.var.deps.db, symbolParam(c.req.param('symbol')), input.fund)
  return c.json(await adjustExits(c.var.deps, trade, input))
})

internal.post('/runs', async (c) => {
  const input = parseBody(runInput, await c.req.json())
  const [row] = await c.var.deps.db.insert(runs).values(input).returning()
  return c.json(row, HTTP_CREATED)
})

internal.get('/funds', async (c) => c.json(await listFunds(c.var.deps.db)))

internal.post('/funds', async (c) => {
  const input = parseBody(fundInput, await c.req.json())
  const { equity } = await c.var.deps.alpaca.account()
  return c.json(await createFund(c.var.deps.db, input, equity), HTTP_CREATED)
})

internal.patch('/funds/:id', async (c) => {
  const input = parseBody(shareInput, await c.req.json())
  const { equity } = await c.var.deps.alpaca.account()
  return c.json(await reallocateFund(c.var.deps.db, c.req.param('id'), input.share, equity))
})

internal.delete('/funds/:id', async (c) => {
  const input = parseBody(retireInput, await c.req.json())
  return c.json(await retireFund(c.var.deps.db, c.req.param('id'), input.reason))
})

internal.post('/agent/run', async (c) =>
  c.text(await startAgentRun(c.env, 'manual'), HTTP_ACCEPTED),
)

internal.get('/agent/health', async (c) => c.text(await agentHealth(c.env)))

internal.post('/agent/restart', async (c) => {
  await restartAgent(c.env)
  return c.text('restarting', HTTP_ACCEPTED)
})

internal.get('/jobs', async (c) =>
  c.json(await listJobs(c.var.deps.db, parseBody(jobsQuery, c.req.query()).fund)),
)

internal.post('/jobs', async (c) => {
  const input = parseBody(jobInput, await c.req.json())
  return c.json(await createJob(c.var.deps.db, input, new Date()), HTTP_CREATED)
})

internal.delete('/jobs/:id', async (c) => {
  const id = parseBody(z.coerce.number().int().positive(), c.req.param('id'))
  return c.json(await cancelJob(c.var.deps.db, id))
})

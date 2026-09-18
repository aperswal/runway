import { count, desc, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { countAnalyses, listAnalyses, symbolsOf } from './analyses'
import type { Db } from './db/client'
import {
  ANALYSIS_KINDS,
  analyses,
  type Analysis,
  type AnalysisKind,
  type Monitor,
} from './db/schema'
import { listFunds } from './funds'
import { listMonitors } from './monitors'
import { withPlain, type View } from './plain'

const STATS_PAGE_SIZE = 25
const STRATEGY_POOL = 200
const TOP_STRATEGIES = 8
const MONITORS_SHOWN = 8

export const statsQuery = z.object({
  kind: z.enum(ANALYSIS_KINDS).optional(),
  fund: z.string().optional(),
  symbol: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  view: z.enum(['plain', 'agent']).default('plain'),
  section: z.enum(['analyses', 'watching', 'strategies']).default('analyses'),
})
export type StatsQuery = z.infer<typeof statsQuery>

export type Strategy = {
  id: number
  title: string
  fund: string
  symbols: string[]
  returnPct: number
  drawdownPct: number | null
  verdict: Analysis['verdict']
}

export type StatsData = {
  query: StatsQuery
  fundNames: Record<string, string>
  kinds: { key: AnalysisKind; n: number }[]
  monitors: Monitor[]
  strategies: Strategy[]
  entries: Analysis[]
  total: number
  pages: number
}

const numericFigure = (a: Analysis, needle: string): number | null => {
  const hit = Object.entries(a.figures).find(
    ([key, value]) => key.toLowerCase().includes(needle) && typeof value === 'number',
  )
  return hit === undefined ? null : Number(hit[1])
}

export function toStrategy(a: Analysis): Strategy | null {
  const returnPct = numericFigure(a, 'return')
  if (returnPct === null) {
    return null
  }
  return {
    id: a.id,
    title: a.title,
    fund: a.fund,
    symbols: symbolsOf(a),
    returnPct,
    drawdownPct: numericFigure(a, 'drawdown'),
    verdict: a.verdict,
  }
}

async function strategies(db: Db): Promise<Strategy[]> {
  const rows = await db
    .select()
    .from(analyses)
    .where(inArray(analyses.kind, ['backtest', 'strategy']))
    .orderBy(desc(analyses.createdAt))
    .limit(STRATEGY_POOL)
  return rows
    .map(toStrategy)
    .filter((s): s is Strategy => s !== null)
    .sort((a, b) => b.returnPct - a.returnPct)
    .slice(0, TOP_STRATEGIES)
}

async function kindCounts(db: Db): Promise<StatsData['kinds']> {
  const rows = await db
    .select({ kind: analyses.kind, n: count() })
    .from(analyses)
    .groupBy(analyses.kind)
  const byKind = new Map(rows.map((r) => [r.kind, r.n]))
  return ANALYSIS_KINDS.map((key) => ({ key, n: byKind.get(key) ?? 0 }))
}

const plainMonitors = (db: Db, rows: Monitor[], view: View): Promise<Monitor[]> =>
  view === 'agent'
    ? Promise.resolve(rows)
    : withPlain(db, 'monitor', rows, (m, t) => ({ ...m, watch: t.body }))

const plainAnalyses = (db: Db, rows: Analysis[], view: View): Promise<Analysis[]> =>
  view === 'agent'
    ? Promise.resolve(rows)
    : withPlain(db, 'analysis', rows, (a, t) => ({ ...a, ...t }))

export async function buildStats(db: Db, query: StatsQuery, now: Date): Promise<StatsData> {
  const { page: requested, view, ...filter } = query
  const [total, allMonitors, allFunds, kinds, topStrategies] = await Promise.all([
    countAnalyses(db, filter),
    listMonitors(db, {}),
    listFunds(db),
    kindCounts(db),
    strategies(db),
  ])
  const pages = Math.max(1, Math.ceil(total / STATS_PAGE_SIZE))
  const page = Math.min(requested, pages)
  const open = allMonitors.filter((m) => m.status !== 'done')
  return {
    query: { ...query, page },
    fundNames: Object.fromEntries(allFunds.map((f) => [f.id, f.name])),
    kinds,
    monitors: await plainMonitors(
      db,
      open
        .filter((m) => m.status === 'due' || m.eventAt >= now.toISOString())
        .slice(0, MONITORS_SHOWN),
      view,
    ),
    strategies: topStrategies,
    entries: await plainAnalyses(
      db,
      await listAnalyses(db, {
        ...filter,
        limit: STATS_PAGE_SIZE,
        offset: (page - 1) * STATS_PAGE_SIZE,
      }),
      view,
    ),
    total,
    pages,
  }
}

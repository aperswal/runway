import {
  createSdkMcpServer,
  tool,
  type McpSdkServerConfigWithInstance,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { UsageError } from './errors.ts'
import type { SiteClient } from './site.ts'
import { attempt, type ToolList } from './tools.ts'

const MAX_SHORT = 120
const MAX_LONG = 2000
const MAX_BODY = 4000
const MAX_LIMIT = 500

export const ANALYSIS_KINDS = [
  'statistical',
  'technical',
  'fundamental',
  'simulation',
  'consequences',
  'backtest',
  'indicators',
  'strategy',
] as const
const MAX_FIGURES = 12
const MAX_FIGURE_TEXT = 40
const MAX_SYMBOLS = 20

const analysisShape = {
  fund: z.string(),
  kind: z
    .enum(ANALYSIS_KINDS)
    .describe(
      'statistical (distributions, correlations, regressions), technical (indicators, levels, regimes), fundamental (filings, unit economics, valuation), simulation (Monte Carlo, scenario paths), consequences (1st, 2nd and 3rd order effects of an event), backtest (a strategy run on history), indicators (how indicators combine), strategy (a rule set you built)',
    ),
  symbols: z.array(z.string()).max(MAX_SYMBOLS).nullable().describe('tickers it covers, or null'),
  title: z.string().max(MAX_SHORT),
  body: z
    .string()
    .max(MAX_BODY)
    .describe(
      'method, findings and what you will do about it; for consequences list 1st, 2nd and 3rd order',
    ),
  figures: z
    .record(z.string().max(MAX_FIGURE_TEXT), z.union([z.number(), z.string().max(MAX_FIGURE_TEXT)]))
    .refine((f) => Object.keys(f).length <= MAX_FIGURES, `at most ${MAX_FIGURES} figures`)
    .describe(
      'up to 12 key numbers, e.g. {"return": 12.4, "drawdown": 8.1, "win rate": 61, "sample": 240}; use "return" and "drawdown" in percent so backtests rank on the Stats page',
    ),
  verdict: z.enum(['adopt', 'reject', 'inconclusive', 'watch']).nullable(),
}
const observationShape = {
  fund: z.string(),
  symbol: z
    .string()
    .max(MAX_SHORT)
    .nullable()
    .describe('ticker or BTC/USD, or null for market-wide'),
  source: z.string().max(MAX_LONG).describe('URL or feed name'),
  metric: z.string().max(MAX_SHORT).describe('what was measured, e.g. "amazon review velocity 7d"'),
  value: z.number().nullable(),
  note: z.string().max(MAX_LONG),
}
const noteShape = {
  fund: z.string(),
  title: z.string().max(MAX_SHORT),
  body: z
    .string()
    .max(MAX_LONG)
    .describe('free-form: a thesis forming, a watchlist, what to check next run'),
}
const lessonShape = {
  fund: z.string(),
  kind: z
    .enum(['technical', 'execution', 'psyche'])
    .describe(
      'technical: what the thesis, signal or level got right or wrong; execution: limit vs market, session, alive window, fills; psyche: what fear, greed, anchoring or sunk cost did to your sizing, targets or patience',
    ),
  lesson: z
    .string()
    .max(MAX_LONG)
    .describe(
      'one or two sentences: the rule you will follow next time, with the numbers behind it',
    ),
  tradeId: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('the closed trade this lesson comes from'),
}
const queryShape = {
  kind: z.enum(['analyses', 'observations', 'notes', 'lessons']),
  fund: z
    .string()
    .optional()
    .describe(
      'analyses and observations are shared: omit fund to read every fund; notes and lessons are private and need your fund',
    ),
  analysisKind: z
    .enum([
      'statistical',
      'technical',
      'fundamental',
      'simulation',
      'consequences',
      'backtest',
      'indicators',
      'strategy',
    ])
    .optional()
    .describe('filter analyses by kind'),
  symbol: z.string().optional(),
  limit: z.number().int().positive().max(MAX_LIMIT).optional(),
}
const PRIVATE_KINDS = ['notes', 'lessons']

function recordAnalysisTool(site: SiteClient): SdkMcpToolDefinition<typeof analysisShape> {
  return tool(
    'record_analysis',
    'Save an analysis (statistical, technical, fundamental, simulation, consequences, backtest, indicators, strategy) with its key figures. Analyses are shown on the public Stats page and read back by future runs.',
    analysisShape,
    (input) => attempt(() => site.recordAnalysis(input)),
  )
}

function recordObservationTool(site: SiteClient): SdkMcpToolDefinition<typeof observationShape> {
  return tool(
    'record_observation',
    'Save a datapoint you measured (a signal, a metric, a fact with its source) to your research memory.',
    observationShape,
    (input) => attempt(() => site.recordObservation(input)),
  )
}

function recordNoteTool(site: SiteClient): SdkMcpToolDefinition<typeof noteShape> {
  return tool(
    'record_note',
    'Write a note to your fund journal. Notes are private to the fund and shown back to you next run.',
    noteShape,
    (input) => attempt(() => site.recordNote(input)),
  )
}

function recordLessonTool(site: SiteClient): SdkMcpToolDefinition<typeof lessonShape> {
  return tool(
    'record_lesson',
    'Write a lesson to your fund journal after a closed trade or a research run: a rule for next time, in one of three kinds (technical, execution, psyche). Lessons are shown back to you every run.',
    lessonShape,
    (input) => attempt(() => site.recordLesson({ ...input, tradeId: input.tradeId ?? null })),
  )
}

function queryResearchTool(site: SiteClient): SdkMcpToolDefinition<typeof queryShape> {
  return tool(
    'query_research',
    "Read back saved analyses, observations, notes or lessons, optionally filtered by symbol. Analyses and observations from every fund are the shared stats corpus; notes and lessons are your fund's own.",
    queryShape,
    (input) => {
      if (PRIVATE_KINDS.includes(input.kind) && input.fund === undefined) {
        return attempt(() =>
          Promise.reject(new UsageError(`${input.kind} are private to a fund; pass fund`)),
        )
      }
      const fields = {
        fund: input.fund,
        kind: input.kind === 'analyses' ? input.analysisKind : undefined,
        symbol: input.symbol,
        limit: input.limit,
      }
      const query = Object.fromEntries(
        Object.entries(fields)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      )
      return attempt(() => site.research(input.kind, query))
    },
  )
}

export const researchTools = (site: SiteClient): ToolList => [
  recordAnalysisTool(site),
  recordObservationTool(site),
  recordNoteTool(site),
  recordLessonTool(site),
  queryResearchTool(site),
]

export function researchServer(site: SiteClient): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: 'research',
    tools: researchTools(site),
  })
}

export const RESEARCH_TOOL_NAMES = [
  'mcp__research__record_analysis',
  'mcp__research__record_observation',
  'mcp__research__record_note',
  'mcp__research__record_lesson',
  'mcp__research__query_research',
]

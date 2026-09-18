import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { QueryOutcome } from './run.ts'
import type { RunReport } from './site.ts'
import { toolFailures } from './tools.ts'

const MAX_REPORTED = 3
const SUMMARY_MARKER = /\n?SUMMARY:[ \t]*\n?/g

export function publishedSummary(text: string): string {
  const marker = [...text.matchAll(SUMMARY_MARKER)].at(-1)
  if (marker === undefined) {
    return text
  }
  const after = text.slice(marker.index + marker[0].length).trim()
  return after.length > 0 ? after : text
}

type Success = SDKResultMessage & { subtype: 'success' }

const succeeded = (result: SDKResultMessage | undefined): result is Success =>
  result?.subtype === 'success' && !result.is_error

function describe(result: SDKResultMessage | undefined): string {
  if (result === undefined) {
    return 'no result message'
  }
  return result.subtype === 'success'
    ? result.result
    : `${result.subtype}: ${result.errors.join('; ')}`
}

export function summaryOf(outcome: QueryOutcome): string {
  if (succeeded(outcome.result)) {
    return outcome.result.result
  }
  return `(no report: ${outcome.error ?? describe(outcome.result)})`
}

export function withToolFailures(report: RunReport, seen: string[] = []): RunReport {
  const all = [...toolFailures, ...seen]
  if (all.length === 0) {
    return report
  }
  const distinct = [...new Set(all)].slice(0, MAX_REPORTED)
  const note = `tool failures (${all.length}): ${distinct.join(' | ')}`
  return { ...report, error: report.error === null ? note : `${report.error}; ${note}` }
}

function problemsOf(outcomes: QueryOutcome[], results: SDKResultMessage[]): string | null {
  const errors = outcomes.flatMap((o) => (o.error === null ? [] : [o.error]))
  const failed = results.filter((r) => !succeeded(r)).map(describe)
  const problems = [...errors, ...failed]
  if (problems.length > 0) {
    return problems.join('; ')
  }
  return outcomes.at(-1)?.result === undefined ? 'no result message' : null
}

export function toReport(trigger: string, startedAt: string, outcomes: QueryOutcome[]): RunReport {
  const results = outcomes.flatMap((o) => (o.result === undefined ? [] : [o.result]))
  const cio = outcomes.at(-1)?.result
  return {
    trigger,
    startedAt,
    finishedAt: new Date().toISOString(),
    turns: results.reduce((sum, r) => sum + r.num_turns, 0),
    costUsd: results.reduce((sum, r) => sum + r.total_cost_usd, 0),
    ...tokenTotals(results),
    summary: succeeded(cio) ? publishedSummary(cio.result) : '',
    error: problemsOf(outcomes, results),
  }
}

function tokenTotals(
  results: SDKResultMessage[],
): Pick<RunReport, 'model' | 'inputTokens' | 'outputTokens'> {
  const entries = results.flatMap((r) => Object.entries(r.modelUsage))
  const models = [...new Set(entries.map(([model]) => model))]
  return {
    model: models.length === 0 ? 'unknown' : models.join(','),
    inputTokens: entries.reduce(
      (sum, [, u]) => sum + u.inputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens,
      0,
    ),
    outputTokens: entries.reduce((sum, [, u]) => sum + u.outputTokens, 0),
  }
}

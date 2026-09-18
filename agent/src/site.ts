import { z } from 'zod'
import type { QueryOutcome } from './run.ts'
import { SiteError } from './errors.ts'
import { sleep } from './sleep.ts'
import { errorMessage, log } from './log.ts'
const fundRecord = z.object({
  id: z.string(),
  name: z.string(),
  mandate: z.string(),
  share: z.number(),
  status: z.enum(['active', 'retired']),
})
const fundList = z.array(fundRecord)
export type FundRecord = z.infer<typeof fundRecord>
const outcomeSchema = z.object({
  result: z.unknown().optional(),
  error: z.string().nullable(),
  seen: z.array(z.string()),
})

export type ResearchKind = 'analyses' | 'observations' | 'notes' | 'lessons'
export type CancelOrder = { fund: string; reason: string }
export type ClosePosition = CancelOrder & { fraction?: number | undefined }

export type RunReport = {
  trigger: string
  startedAt: string
  finishedAt: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  turns: number
  summary: string
  error: string | null
}

const POLL_MS = 30_000
const MANAGER_DEADLINE_MINUTES = 55
const MS_PER_MINUTE = 60_000
const MANAGER_DEADLINE_MS = MANAGER_DEADLINE_MINUTES * MS_PER_MINUTE
const startedSchema = z.object({ key: z.string().min(1) })
const reportSchema = z.object({ done: z.boolean(), outcome: z.unknown() })
type Report = z.infer<typeof reportSchema>

export class SiteClient {
  private readonly baseUrl: string
  private readonly token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl
    this.token = token
  }

  context(trigger: string, fund?: string): Promise<string> {
    const scope = fund === undefined ? '' : `&fund=${encodeURIComponent(fund)}`
    return this.call('GET', `/internal/context?trigger=${encodeURIComponent(trigger)}${scope}`)
  }

  openPosition(body: unknown): Promise<string> {
    return this.call('POST', '/internal/positions', body)
  }

  closePosition(symbol: string, body: ClosePosition): Promise<string> {
    return this.call('DELETE', `/internal/positions/${encodeURIComponent(symbol)}`, body)
  }

  optionContracts(query: Record<string, string>): Promise<string> {
    return this.call('GET', `/internal/options/contracts?${new URLSearchParams(query).toString()}`)
  }

  cancelOrder(symbol: string, body: CancelOrder): Promise<string> {
    return this.call('DELETE', `/internal/orders/${encodeURIComponent(symbol)}`, body)
  }

  adjustExits(symbol: string, body: unknown): Promise<string> {
    return this.call('PATCH', `/internal/positions/${encodeURIComponent(symbol)}`, body)
  }

  recordRun(report: RunReport): Promise<string> {
    return this.call('POST', '/internal/runs', report)
  }

  async funds(): Promise<FundRecord[]> {
    return fundList.parse(JSON.parse(await this.call('GET', '/internal/funds')))
  }

  createFund(body: unknown): Promise<string> {
    return this.call('POST', '/internal/funds', body)
  }

  reallocateFund(id: string, share: number): Promise<string> {
    return this.call('PATCH', `/internal/funds/${encodeURIComponent(id)}`, { share })
  }

  retireFund(id: string, reason: string): Promise<string> {
    return this.call('DELETE', `/internal/funds/${encodeURIComponent(id)}`, { reason })
  }

  recordAnalysis(body: unknown): Promise<string> {
    return this.call('POST', '/internal/analyses', body)
  }

  createMonitor(body: unknown): Promise<string> {
    return this.call('POST', '/internal/monitors', body)
  }

  listMonitors(fund: string): Promise<string> {
    return this.call('GET', `/internal/monitors?fund=${encodeURIComponent(fund)}`)
  }

  resolveMonitor(id: number, outcome: string): Promise<string> {
    return this.call('PATCH', `/internal/monitors/${id}`, { outcome })
  }

  recordObservation(body: unknown): Promise<string> {
    return this.call('POST', '/internal/observations', body)
  }

  recordNote(body: unknown): Promise<string> {
    return this.call('POST', '/internal/notes', body)
  }

  recordLesson(body: unknown): Promise<string> {
    return this.call('POST', '/internal/lessons', body)
  }

  createJob(body: unknown): Promise<string> {
    return this.call('POST', '/internal/jobs', body)
  }

  listJobs(fund: string): Promise<string> {
    return this.call('GET', `/internal/jobs?fund=${encodeURIComponent(fund)}`)
  }

  cancelJob(id: number): Promise<string> {
    return this.call('DELETE', `/internal/jobs/${id}`)
  }

  async manager(fund: string, trigger: string): Promise<QueryOutcome> {
    const path = `/internal/managers/${encodeURIComponent(fund)}`
    const { key } = startedSchema.parse(
      JSON.parse(await this.call('POST', `${path}/run`, { trigger })),
    )
    const deadline = Date.now() + MANAGER_DEADLINE_MS
    while (Date.now() < deadline) {
      await sleep(POLL_MS)
      const report = await this.pollReport(fund, `${path}/report?key=${key}`)
      if (report?.done === true) {
        return outcomeSchema.parse(report.outcome) as QueryOutcome
      }
    }
    return {
      result: undefined,
      error: `manager ${fund} did not report within ${MANAGER_DEADLINE_MINUTES} minutes`,
      seen: [],
    }
  }

  private async pollReport(fund: string, path: string): Promise<Report | null> {
    try {
      return reportSchema.parse(JSON.parse(await this.call('GET', path)))
    } catch (error) {
      log.error({ message: 'manager report poll failed', fund, error: errorMessage(error) })
      return null
    }
  }

  report(fund: string, key: string, outcome: QueryOutcome): Promise<string> {
    return this.call('POST', `/internal/managers/${encodeURIComponent(fund)}/report`, {
      key,
      outcome,
    })
  }

  trades(query: Record<string, string>): Promise<string> {
    return this.call('GET', `/internal/trades?${new URLSearchParams(query).toString()}`)
  }

  research(kind: ResearchKind, query: Record<string, string>): Promise<string> {
    return this.call('GET', `/internal/${kind}?${new URLSearchParams(query).toString()}`)
  }

  private async call(method: string, path: string, body?: unknown): Promise<string> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) {
      throw new SiteError(res.status, text)
    }
    return text
  }
}

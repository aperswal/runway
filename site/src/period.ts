export const PERIOD_DAYS = 30
const DAY_MS = 86_400_000
const PERIOD_MS = PERIOD_DAYS * DAY_MS

export type Period = {
  index: number
  start: string
  end: string
  daysLeft: number
  elapsed: number
}

const iso = (ms: number): string => new Date(ms).toISOString()

export function periodOf(anchorIso: string, now: Date): Period {
  const anchor = new Date(anchorIso).getTime()
  const index = Math.max(0, Math.floor((now.getTime() - anchor) / PERIOD_MS))
  const start = anchor + index * PERIOD_MS
  const end = start + PERIOD_MS
  return {
    index,
    start: iso(start),
    end: iso(end),
    daysLeft: Math.min(PERIOD_DAYS, Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS))),
    elapsed: Math.min(1, Math.max(0, (now.getTime() - start) / PERIOD_MS)),
  }
}

export const periodEnd = (startIso: string): string => iso(new Date(startIso).getTime() + PERIOD_MS)

export function endedPeriods(anchorIso: string, now: Date): string[] {
  const anchor = new Date(anchorIso).getTime()
  const ended = Math.max(0, Math.floor((now.getTime() - anchor) / PERIOD_MS))
  return Array.from({ length: ended }, (_, i) => iso(anchor + i * PERIOD_MS))
}

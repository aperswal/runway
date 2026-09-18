const TIME_ZONE = 'America/New_York'
const YEAR_LENGTH = 4
const MONTH_OFFSET = 5
const MONTH_LENGTH = 7
const DAY_OFFSET = 8
const MS_PER_MINUTE = 60_000
const MS_PER_HOUR = 3_600_000
const MS_PER_DAY = 86_400_000
const HOURS_SHOWN_UNTIL = 48

const EASTERN_DATE: Intl.DateTimeFormatOptions = {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}

const SHORT_DATE: Intl.DateTimeFormatOptions = {
  timeZone: TIME_ZONE,
  month: 'short',
  day: 'numeric',
}

export const easternDay = (date: Date): string =>
  new Intl.DateTimeFormat('en-CA', EASTERN_DATE).format(date)
export const easternMonth = (date: Date): string => easternDay(date).slice(0, MONTH_LENGTH)
export const shortDay = (date: Date): string =>
  new Intl.DateTimeFormat('en-US', SHORT_DATE).format(date)
export const dayOfMonth = (date: Date): number => Number(easternDay(date).slice(DAY_OFFSET))

export const monthParts = (month: string): { year: number; month: number } => ({
  year: Number(month.slice(0, YEAR_LENGTH)),
  month: Number(month.slice(MONTH_OFFSET, MONTH_LENGTH)),
})

export function daysLeftInMonth(now: Date): number {
  const { year, month } = monthParts(easternMonth(now))
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return daysInMonth - dayOfMonth(now) + 1
}

export const nowIso = (): string => new Date().toISOString()

export const minutesBetween = (fromIso: string, to: Date): number =>
  (to.getTime() - new Date(fromIso).getTime()) / MS_PER_MINUTE

export function holdDuration(fromIso: string, toIso: string): string {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime()
  if (ms < MS_PER_HOUR) {
    return plural(Math.max(1, Math.round(ms / MS_PER_MINUTE)), 'minute')
  }
  if (ms < HOURS_SHOWN_UNTIL * MS_PER_HOUR) {
    return plural(Math.round(ms / MS_PER_HOUR), 'hour')
  }
  return plural(Math.round(ms / MS_PER_DAY), 'day')
}

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`

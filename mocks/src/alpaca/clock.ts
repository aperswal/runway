export type Clock = { timestamp: string; is_open: boolean; next_open: string; next_close: string }

const NEW_YORK = 'America/New_York'
const OPEN_HOUR = 9
const OPEN_MINUTE = 30
const CLOSE_HOUR = 16
const MINUTES_PER_HOUR = 60
const DAY_MS = 86400000
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const OFFSET_PREFIX = 'GMT'
const TWO_DIGITS = 2

type EasternParts = {
  weekday: string
  year: string
  month: string
  day: string
  minuteOfDay: number
  offset: string
}

const FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: NEW_YORK,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'longOffset',
}

const parseOffset = (timeZoneName: string): string => timeZoneName.slice(OFFSET_PREFIX.length)

export function easternParts(date: Date): EasternParts {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', FORMAT)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  ) as Record<Intl.DateTimeFormatPartTypes, string>
  return {
    weekday: parts.weekday,
    year: parts.year,
    month: parts.month,
    day: parts.day,
    minuteOfDay: Number(parts.hour) * MINUTES_PER_HOUR + Number(parts.minute),
    offset: parseOffset(parts.timeZoneName),
  }
}

const atEastern = (parts: EasternParts, hour: number, minute: number): Date => {
  const hh = String(hour).padStart(TWO_DIGITS, '0')
  const mm = String(minute).padStart(TWO_DIGITS, '0')
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${hh}:${mm}:00${parts.offset}`)
}

const isWeekday = (parts: EasternParts): boolean => WEEKDAYS.includes(parts.weekday)

const OPEN_MINUTE_OF_DAY = OPEN_HOUR * MINUTES_PER_HOUR + OPEN_MINUTE
const CLOSE_MINUTE_OF_DAY = CLOSE_HOUR * MINUTES_PER_HOUR

export const isMarketOpen = (now: Date): boolean => {
  const parts = easternParts(now)
  return (
    isWeekday(parts) &&
    parts.minuteOfDay >= OPEN_MINUTE_OF_DAY &&
    parts.minuteOfDay < CLOSE_MINUTE_OF_DAY
  )
}

function nextSessionDay(now: Date): EasternParts {
  const today = easternParts(now)
  if (isWeekday(today) && today.minuteOfDay < OPEN_MINUTE_OF_DAY) {
    return today
  }
  let candidate: EasternParts
  let days = 0
  do {
    days += 1
    candidate = easternParts(new Date(now.getTime() + days * DAY_MS))
  } while (!isWeekday(candidate))
  return candidate
}

export function marketClock(now: Date, override: boolean | undefined): Clock {
  const open = override ?? isMarketOpen(now)
  const session = nextSessionDay(now)
  const closeDay = open ? easternParts(now) : session
  return {
    timestamp: now.toISOString(),
    is_open: open,
    next_open: atEastern(session, OPEN_HOUR, OPEN_MINUTE).toISOString(),
    next_close: atEastern(closeDay, CLOSE_HOUR, 0).toISOString(),
  }
}

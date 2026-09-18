type Event = Record<string, unknown>
type Level = 'info' | 'error'

const write = (level: Level, event: Event): void => {
  const line = JSON.stringify({ level, ...event })
  if (level === 'error') {
    console.error(line)
  } else {
    console.log(line)
  }
}

export const log = {
  info: (event: Event): void => write('info', event),
  error: (event: Event): void => write('error', event),
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

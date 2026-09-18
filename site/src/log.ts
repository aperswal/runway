type Event = Record<string, unknown>

export const log = {
  info(event: Event): void {
    console.log(JSON.stringify({ level: 'info', ...event }))
  },
  error(event: Event): void {
    console.error(JSON.stringify({ level: 'error', ...event }))
  },
}

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

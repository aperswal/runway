import { UsageError } from '../errors.ts'

export type Flags = Record<string, string>

export type ParsedArgs = { source: string; command: string; flags: Flags }

const FLAG_PREFIX = '--'

function readFlag(token: string, next: string | undefined, flags: Flags): boolean {
  const name = token.slice(FLAG_PREFIX.length)
  const equals = name.indexOf('=')
  if (equals !== -1) {
    flags[name.slice(0, equals)] = name.slice(equals + 1)
    return false
  }
  if (next === undefined || next.startsWith(FLAG_PREFIX)) {
    throw new UsageError(`--${name} needs a value`)
  }
  flags[name] = next
  return true
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Flags = {}
  let skipNext = false
  for (const [index, token] of argv.entries()) {
    if (skipNext) {
      skipNext = false
    } else if (token.startsWith(FLAG_PREFIX)) {
      skipNext = readFlag(token, argv[index + 1], flags)
    } else {
      positionals.push(token)
    }
  }
  return { source: positionals[0] ?? '', command: positionals[1] ?? '', flags }
}

export function requireFlag(flags: Flags, name: string): string {
  const value = flags[name]
  if (value === undefined || value.length === 0) {
    throw new UsageError(`--${name} is required`)
  }
  return value
}

export function intFlag(flags: Flags, name: string, fallback: number): number {
  const raw = flags[name]
  if (raw === undefined) {
    return fallback
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new UsageError(`--${name} must be a positive integer, got "${raw}"`)
  }
  return value
}

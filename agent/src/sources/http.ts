import type { ZodType } from 'zod'
import { HttpError, SourceError, describeIssues } from '../errors.ts'

export async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const res = await fetch(url, init)
  const text = await res.text()
  if (!res.ok) {
    throw new HttpError(url, res.status, text)
  }
  return text
}

export async function fetchJson<T>(
  url: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  return parseJson(schema, await fetchText(url, init), url)
}

export function parseJson<T>(schema: ZodType<T>, text: string, label: string): T {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new SourceError(`${label} is not valid JSON`)
  }
  return parseShape(schema, raw, label)
}

export function parseShape<T>(schema: ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new SourceError(
      `${label} has an unexpected shape: ${describeIssues(parsed.error.issues)}`,
    )
  }
  return parsed.data
}

export function withQuery(base: string, params: Record<string, string>): string {
  return `${base}?${new URLSearchParams(params).toString()}`
}

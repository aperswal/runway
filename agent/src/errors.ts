import type { z } from 'zod'

export class SiteError extends Error {
  readonly status: number
  readonly body: string

  constructor(status: number, body: string) {
    super(`site ${status}: ${body}`)
    this.name = 'SiteError'
    this.status = status
    this.body = body
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

const ERROR_BODY_LIMIT = 300

export class MissingEnvError extends Error {
  readonly variable: string

  constructor(variable: string) {
    super(`${variable} is not set. Set the ${variable} environment variable and retry.`)
    this.name = 'MissingEnvError'
    this.variable = variable
  }
}

export class HttpError extends Error {
  readonly status: number
  readonly url: string

  constructor(url: string, status: number, body: string) {
    super(`${url} responded ${status}: ${body.slice(0, ERROR_BODY_LIMIT)}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

export class SourceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceError'
  }
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export const describeIssues = (issues: z.core.$ZodIssue[]): string =>
  issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')

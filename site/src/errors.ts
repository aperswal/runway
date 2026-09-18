export class ExternalServiceError extends Error {
  readonly service: string
  readonly status: number

  constructor(service: string, status: number, detail: string) {
    super(`${service} ${status}: ${detail}`)
    this.name = 'ExternalServiceError'
    this.service = service
    this.status = status
  }
}

export class StateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StateError'
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export class InputError extends Error {
  readonly issues: unknown

  constructor(message: string, issues: unknown) {
    super(message)
    this.name = 'InputError'
    this.issues = issues
  }
}

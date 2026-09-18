export const STATUS = {
  ok: 200,
  created: 201,
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  noContent: 204,
  unprocessable: 422,
  upgradeRequired: 426,
  internalError: 500,
} as const

const ALPACA_BAD_REQUEST_CODE = 40010001
const ALPACA_FORBIDDEN_CODE = 40310000
const ALPACA_NOT_FOUND_CODE = 40410000
const LINKEDIN_INVALID_TOKEN_CODE = 65600

type Issue = { path: PropertyKey[]; message: string }

export const issueMessages = (issues: Issue[]): string =>
  issues.map((issue) => issue.message).join('; ')

export const issueDetail = (issues: Issue[]): string =>
  issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly body: Record<string, unknown>

  constructor(status: number, body: Record<string, unknown>, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

class AlpacaError extends ApiError {
  constructor(status: number, code: number, message: string) {
    super(status, { code, message }, message)
  }
}

export class AlpacaUnauthorizedError extends ApiError {
  constructor() {
    const message = 'unauthorized.'
    super(STATUS.unauthorized, { message }, message)
    this.name = 'AlpacaUnauthorizedError'
  }
}

export class AlpacaBadRequestError extends AlpacaError {
  constructor(message: string) {
    super(STATUS.badRequest, ALPACA_BAD_REQUEST_CODE, message)
    this.name = 'AlpacaBadRequestError'
  }
}

export class AlpacaUnprocessableError extends AlpacaError {
  constructor(message: string) {
    super(STATUS.unprocessable, ALPACA_BAD_REQUEST_CODE, message)
    this.name = 'AlpacaUnprocessableError'
  }
}

export class InsufficientBuyingPowerError extends AlpacaError {
  constructor() {
    super(STATUS.forbidden, ALPACA_FORBIDDEN_CODE, 'insufficient buying power')
    this.name = 'InsufficientBuyingPowerError'
  }
}

export class InsufficientQtyError extends AlpacaError {
  constructor() {
    super(STATUS.forbidden, ALPACA_FORBIDDEN_CODE, 'insufficient qty available for order')
    this.name = 'InsufficientQtyError'
  }
}

export class PositionNotFoundError extends AlpacaError {
  constructor() {
    super(STATUS.notFound, ALPACA_NOT_FOUND_CODE, 'position does not exist')
    this.name = 'PositionNotFoundError'
  }
}

export class OrderNotFoundError extends AlpacaError {
  constructor() {
    super(STATUS.notFound, ALPACA_NOT_FOUND_CODE, 'order not found')
    this.name = 'OrderNotFoundError'
  }
}

export class OrderNotCancelableError extends AlpacaError {
  constructor() {
    super(STATUS.unprocessable, ALPACA_BAD_REQUEST_CODE, 'order is not cancelable')
    this.name = 'OrderNotCancelableError'
  }
}

export class AlpacaNotFoundError extends AlpacaError {
  constructor(message: string) {
    super(STATUS.notFound, ALPACA_NOT_FOUND_CODE, message)
    this.name = 'AlpacaNotFoundError'
  }
}

export class XError extends ApiError {
  constructor(status: number, title: string, detail: string, errors?: string[]) {
    const body: Record<string, unknown> = { title, detail, type: 'about:blank', status }
    if (errors !== undefined) {
      body.errors = errors.map((message) => ({ message }))
    }
    super(status, body, detail)
    this.name = 'XError'
  }
}

export class LinkedInError extends ApiError {
  constructor(status: number, message: string) {
    super(status, { message, status }, message)
    this.name = 'LinkedInError'
  }
}

export class LinkedInUnauthorizedError extends ApiError {
  constructor() {
    const message = 'Invalid access token'
    const body = {
      serviceErrorCode: LINKEDIN_INVALID_TOKEN_CODE,
      message,
      status: STATUS.unauthorized,
    }
    super(STATUS.unauthorized, body, message)
    this.name = 'LinkedInUnauthorizedError'
  }
}

export class InvalidJsonError extends ApiError {
  constructor() {
    const message = 'invalid json body'
    super(STATUS.badRequest, { message }, message)
    this.name = 'InvalidJsonError'
  }
}

import { describe, expect, it } from 'vitest'
import {
  AlpacaBadRequestError,
  AlpacaNotFoundError,
  AlpacaUnauthorizedError,
  AlpacaUnprocessableError,
  ApiError,
  ConfigError,
  InsufficientBuyingPowerError,
  InsufficientQtyError,
  InvalidJsonError,
  LinkedInError,
  LinkedInUnauthorizedError,
  OrderNotCancelableError,
  OrderNotFoundError,
  PositionNotFoundError,
  XError,
  issueDetail,
  issueMessages,
} from './errors.ts'

type Case = {
  error: ApiError
  name: string
  status: number
  body: Record<string, unknown>
  message: string
}

const cases: Case[] = [
  {
    error: new ApiError(418, { a: 1 }, 'teapot'),
    name: 'ApiError',
    status: 418,
    body: { a: 1 },
    message: 'teapot',
  },
  {
    error: new AlpacaUnauthorizedError(),
    name: 'AlpacaUnauthorizedError',
    status: 401,
    body: { message: 'unauthorized.' },
    message: 'unauthorized.',
  },
  {
    error: new AlpacaBadRequestError('bad'),
    name: 'AlpacaBadRequestError',
    status: 400,
    body: { code: 40010001, message: 'bad' },
    message: 'bad',
  },
  {
    error: new AlpacaUnprocessableError('nope'),
    name: 'AlpacaUnprocessableError',
    status: 422,
    body: { code: 40010001, message: 'nope' },
    message: 'nope',
  },
  {
    error: new InsufficientBuyingPowerError(),
    name: 'InsufficientBuyingPowerError',
    status: 403,
    body: { code: 40310000, message: 'insufficient buying power' },
    message: 'insufficient buying power',
  },
  {
    error: new InsufficientQtyError(),
    name: 'InsufficientQtyError',
    status: 403,
    body: { code: 40310000, message: 'insufficient qty available for order' },
    message: 'insufficient qty available for order',
  },
  {
    error: new PositionNotFoundError(),
    name: 'PositionNotFoundError',
    status: 404,
    body: { code: 40410000, message: 'position does not exist' },
    message: 'position does not exist',
  },
  {
    error: new OrderNotCancelableError(),
    name: 'OrderNotCancelableError',
    status: 422,
    body: { code: 40010001, message: 'order is not cancelable' },
    message: 'order is not cancelable',
  },
  {
    error: new OrderNotFoundError(),
    name: 'OrderNotFoundError',
    status: 404,
    body: { code: 40410000, message: 'order not found' },
    message: 'order not found',
  },
  {
    error: new AlpacaNotFoundError('gone'),
    name: 'AlpacaNotFoundError',
    status: 404,
    body: { code: 40410000, message: 'gone' },
    message: 'gone',
  },
  {
    error: new XError(403, 'Forbidden', 'nope', ['too long']),
    name: 'XError',
    status: 403,
    body: {
      title: 'Forbidden',
      detail: 'nope',
      type: 'about:blank',
      status: 403,
      errors: [{ message: 'too long' }],
    },
    message: 'nope',
  },
  {
    error: new XError(401, 'Unauthorized', 'no'),
    name: 'XError',
    status: 401,
    body: { title: 'Unauthorized', detail: 'no', type: 'about:blank', status: 401 },
    message: 'no',
  },
  {
    error: new LinkedInError(426, 'old'),
    name: 'LinkedInError',
    status: 426,
    body: { message: 'old', status: 426 },
    message: 'old',
  },
  {
    error: new LinkedInUnauthorizedError(),
    name: 'LinkedInUnauthorizedError',
    status: 401,
    body: { serviceErrorCode: 65600, message: 'Invalid access token', status: 401 },
    message: 'Invalid access token',
  },
  {
    error: new InvalidJsonError(),
    name: 'InvalidJsonError',
    status: 400,
    body: { message: 'invalid json body' },
    message: 'invalid json body',
  },
]

describe('api errors', () => {
  it.each(cases)('$name carries its status, body and message', (expected) => {
    const { error } = expected
    expect(error).toBeInstanceOf(ApiError)
    expect(error.name).toBe(expected.name)
    expect(error.status).toBe(expected.status)
    expect(error.body).toEqual(expected.body)
    expect(error.message).toBe(expected.message)
  })

  it('names config errors', () => {
    const error = new ConfigError('config: bad')
    expect(error.name).toBe('ConfigError')
    expect(error.message).toBe('config: bad')
  })
})

describe('issue formatting', () => {
  const issues = [
    { path: ['distribution', 'feedDistribution'], message: 'Invalid option' },
    { path: ['commentary'], message: 'Too small' },
  ]

  it('joins messages', () => {
    expect(issueMessages(issues)).toBe('Invalid option; Too small')
  })

  it('joins dotted paths with messages', () => {
    expect(issueDetail(issues)).toBe(
      'distribution.feedDistribution Invalid option; commentary Too small',
    )
  })
})

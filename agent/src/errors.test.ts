import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  HttpError,
  MissingEnvError,
  SiteError,
  SourceError,
  UsageError,
} from './errors.ts'

describe('errors', () => {
  it('SiteError keeps the status and body', () => {
    const error = new SiteError(409, 'run in progress')
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      name: 'SiteError',
      status: 409,
      body: 'run in progress',
      message: 'site 409: run in progress',
    })
  })
  it('ConfigError carries the message', () =>
    expect(new ConfigError('bad config')).toMatchObject({
      name: 'ConfigError',
      message: 'bad config',
    }))
  it('MissingEnvError names the variable', () =>
    expect(new MissingEnvError('APIFY_TOKEN')).toMatchObject({
      name: 'MissingEnvError',
      variable: 'APIFY_TOKEN',
      message: 'APIFY_TOKEN is not set. Set the APIFY_TOKEN environment variable and retry.',
    }))
  it('HttpError truncates the body to 300 characters', () => {
    const error = new HttpError('https://x.test', 500, 'a'.repeat(400))
    expect(error).toMatchObject({ name: 'HttpError', status: 500, url: 'https://x.test' })
    expect(error.message).toBe(`https://x.test responded 500: ${'a'.repeat(300)}`)
  })
  it('SourceError is named', () =>
    expect(new SourceError('bad feed')).toMatchObject({ name: 'SourceError', message: 'bad feed' }))
  it('UsageError is named', () =>
    expect(new UsageError('--q is required')).toMatchObject({
      name: 'UsageError',
      message: '--q is required',
    }))
})

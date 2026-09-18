import { afterEach, describe, expect, it, vi } from 'vitest'
import { db, jsonBody, resetDb, stubFetch } from '../test/helpers'
import {
  accessTokenExpiry,
  codexAuthStatus,
  loadCodexAuth,
  refreshCodexAuth,
  storeCodexAuth,
} from './codex-auth'

const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const EXP = 1_790_000_000
const jwt = (claims: Record<string, unknown>): string =>
  `h.${btoa(JSON.stringify(claims)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}.s`
const access = jwt({ exp: EXP })
const auth = {
  auth_mode: 'chatgpt',
  tokens: { id_token: 'id-1', access_token: access, refresh_token: 'refresh-1', account_id: 'a' },
  last_refresh: '2026-09-10T00:00:00.000Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('storeCodexAuth and codexAuthStatus', () => {
  it('keeps the whole auth file, reports the refresh time and the access token expiry', async () => {
    await resetDb()
    expect(await codexAuthStatus(db)).toEqual({
      configured: false,
      refreshedAt: null,
      accessTokenExpiresAt: null,
    })
    expect(await loadCodexAuth(db)).toBeUndefined()
    await storeCodexAuth(db, auth)
    expect(JSON.parse((await loadCodexAuth(db)) ?? '')).toEqual(auth)
    expect(await codexAuthStatus(db)).toEqual({
      configured: true,
      refreshedAt: '2026-09-10T00:00:00.000Z',
      accessTokenExpiresAt: '2026-09-21T14:13:20.000Z',
    })
    await storeCodexAuth(db, { ...auth, last_refresh: '2026-09-11T00:00:00.000Z' })
    expect((await codexAuthStatus(db)).refreshedAt).toBe('2026-09-11T00:00:00.000Z')
  })

  it('rejects an auth file without tokens', async () => {
    await resetDb()
    await expect(storeCodexAuth(db, { tokens: {} })).rejects.toThrow('invalid input')
    await expect(storeCodexAuth(db, { ...auth, last_refresh: 'soon' })).rejects.toThrow(
      'invalid input',
    )
  })

  it('reads the expiry out of the access token and tolerates junk', () => {
    expect(accessTokenExpiry(access)).toBe('2026-09-21T14:13:20.000Z')
    expect(accessTokenExpiry('nope')).toBeNull()
    expect(accessTokenExpiry('a.b.c')).toBeNull()
    expect(accessTokenExpiry(jwt({ sub: 'x' }))).toBeNull()
  })
})

describe('refreshCodexAuth', () => {
  it('does nothing without a stored auth or before three days have passed', async () => {
    await resetDb()
    const { fetch } = stubFetch([])
    await refreshCodexAuth(db, new Date('2026-09-20T00:00:00.000Z'))
    await storeCodexAuth(db, auth)
    await refreshCodexAuth(db, new Date('2026-09-12T23:59:59.000Z'))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rotates the tokens through the OpenAI token endpoint once they are three days old', async () => {
    await resetDb()
    await storeCodexAuth(db, auth)
    const { calls } = stubFetch([
      {
        url: TOKEN_URL,
        method: 'POST',
        body: { id_token: 'id-2', access_token: 'access-2', refresh_token: 'refresh-2' },
      },
    ])
    await refreshCodexAuth(db, new Date('2026-09-13T00:00:00.000Z'))
    expect(jsonBody(calls[0])).toEqual({
      grant_type: 'refresh_token',
      client_id: 'app_EMoamEEZ73f0CkXaXp7hrann',
      refresh_token: 'refresh-1',
    })
    expect(JSON.parse((await loadCodexAuth(db)) ?? '')).toEqual({
      ...auth,
      tokens: {
        ...auth.tokens,
        id_token: 'id-2',
        access_token: 'access-2',
        refresh_token: 'refresh-2',
      },
      last_refresh: '2026-09-13T00:00:00.000Z',
    })
  })

  it('refreshes at once when forced and keeps fields the endpoint leaves out', async () => {
    await resetDb()
    await storeCodexAuth(db, auth)
    stubFetch([{ url: TOKEN_URL, method: 'POST', body: {} }])
    await refreshCodexAuth(db, new Date('2026-09-10T00:01:00.000Z'), { force: true })
    expect(JSON.parse((await loadCodexAuth(db)) ?? '')).toEqual({
      ...auth,
      last_refresh: '2026-09-10T00:01:00.000Z',
    })
  })

  it('fails loudly and keeps the old tokens when the endpoint refuses', async () => {
    await resetDb()
    await storeCodexAuth(db, auth)
    stubFetch([{ url: TOKEN_URL, method: 'POST', status: 400, body: 'invalid_grant' }])
    await expect(refreshCodexAuth(db, new Date('2026-09-20T00:00:00.000Z'))).rejects.toThrow(
      'codex auth refresh 400: invalid_grant',
    )
    expect(JSON.parse((await loadCodexAuth(db)) ?? '')).toEqual(auth)
  })
})

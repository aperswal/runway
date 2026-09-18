import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/client'
import { codexAuth } from './db/schema'
import { ExternalServiceError } from './errors'
import { log } from './log'
import { parseBody } from './parse'

export type CodexAuthStatus = {
  configured: boolean
  refreshedAt: string | null
  accessTokenExpiresAt: string | null
}

const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REFRESH_AFTER_DAYS = 3
const MS_PER_DAY = 86_400_000
const ROW_ID = 1
const JWT_PAYLOAD = 1
const MS_PER_SECOND = 1000

const tokensSchema = z.object({
  id_token: z.string().min(1),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  account_id: z.string().optional(),
})
const authSchema = z.looseObject({ tokens: tokensSchema, last_refresh: z.iso.datetime() })
type Auth = z.infer<typeof authSchema>

const refreshedSchema = z.object({
  id_token: z.string().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
})

async function readRow(db: Db): Promise<Auth | undefined> {
  const [row] = await db.select().from(codexAuth).where(eq(codexAuth.id, ROW_ID))
  return row === undefined ? undefined : authSchema.parse(JSON.parse(row.auth))
}

async function writeRow(db: Db, auth: Auth): Promise<void> {
  const values = { id: ROW_ID, auth: JSON.stringify(auth), refreshedAt: auth.last_refresh }
  await db
    .insert(codexAuth)
    .values(values)
    .onConflictDoUpdate({ target: codexAuth.id, set: values })
}

export async function storeCodexAuth(db: Db, raw: unknown): Promise<void> {
  await writeRow(db, parseBody(authSchema, raw))
}

export async function loadCodexAuth(db: Db): Promise<string | undefined> {
  const auth = await readRow(db)
  return auth === undefined ? undefined : JSON.stringify(auth)
}

export function accessTokenExpiry(token: string): string | null {
  const payload = token.split('.')[JWT_PAYLOAD]
  if (payload === undefined) {
    return null
  }
  try {
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    const exp = z.object({ exp: z.number() }).parse(claims).exp
    return new Date(exp * MS_PER_SECOND).toISOString()
  } catch {
    return null
  }
}

export async function codexAuthStatus(db: Db): Promise<CodexAuthStatus> {
  const auth = await readRow(db)
  if (auth === undefined) {
    return { configured: false, refreshedAt: null, accessTokenExpiresAt: null }
  }
  return {
    configured: true,
    refreshedAt: auth.last_refresh,
    accessTokenExpiresAt: accessTokenExpiry(auth.tokens.access_token),
  }
}

const isDue = (auth: Auth, now: Date): boolean =>
  now.getTime() - new Date(auth.last_refresh).getTime() >= REFRESH_AFTER_DAYS * MS_PER_DAY

async function requestRefresh(refreshToken: string): Promise<z.infer<typeof refreshedSchema>> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }),
  })
  if (!res.ok) {
    throw new ExternalServiceError('codex auth refresh', res.status, await res.text())
  }
  return refreshedSchema.parse(await res.json())
}

const rotated = (auth: Auth, fresh: z.infer<typeof refreshedSchema>, now: Date): Auth => ({
  ...auth,
  tokens: {
    ...auth.tokens,
    id_token: fresh.id_token ?? auth.tokens.id_token,
    access_token: fresh.access_token ?? auth.tokens.access_token,
    refresh_token: fresh.refresh_token ?? auth.tokens.refresh_token,
  },
  last_refresh: now.toISOString(),
})

export async function refreshCodexAuth(
  db: Db,
  now: Date,
  options: { force: boolean } = { force: false },
): Promise<void> {
  const auth = await readRow(db)
  if (auth === undefined || (!options.force && !isDue(auth, now))) {
    return
  }
  await writeRow(db, rotated(auth, await requestRefresh(auth.tokens.refresh_token), now))
  log.info({ message: 'codex auth refreshed', at: now.toISOString() })
}

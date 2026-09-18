import { getContainer } from '@cloudflare/containers'
import { and, eq, isNull } from 'drizzle-orm'
import { loadCodexAuth } from './codex-auth'
import type { Db } from './db/client'
import { managerRuns } from './db/schema'
import { parseConfig, type Bindings } from './env'
import { ExternalServiceError, StateError } from './errors'
import { nowIso } from './time'

const HTTP_ACCEPTED = 202

export type ManagerReport = { done: boolean; outcome: unknown }
type Deps = { db: Db; env: Bindings & Record<string, unknown> }

export async function startManager(deps: Deps, fund: string, trigger: string): Promise<string> {
  const key = crypto.randomUUID()
  await deps.db.insert(managerRuns).values({ key, fund, trigger, startedAt: nowIso() })
  const config = parseConfig(deps.env)
  const codexAuth = await loadCodexAuth(deps.db)
  const container = getContainer(deps.env.AGENT, `manager-${fund}`)
  const res = await container.fetch(
    new Request('http://agent/manager', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        fund,
        trigger,
        key,
        ...(codexAuth === undefined ? {} : { codexAuth }),
      }),
    }),
  )
  if (res.status !== HTTP_ACCEPTED) {
    await container.destroy()
    throw new ExternalServiceError('manager container', res.status, await res.text())
  }
  return key
}

export async function reportManager(
  deps: Deps,
  fund: string,
  key: string,
  outcome: unknown,
): Promise<void> {
  const [row] = await deps.db
    .update(managerRuns)
    .set({ outcome: JSON.stringify(outcome), finishedAt: nowIso() })
    .where(
      and(eq(managerRuns.key, key), eq(managerRuns.fund, fund), isNull(managerRuns.finishedAt)),
    )
    .returning()
  if (row === undefined) {
    throw new StateError(`no running manager ${fund} with key ${key}`)
  }
  await getContainer(deps.env.AGENT, `manager-${fund}`).destroy()
}

export async function managerReport(db: Db, fund: string, key: string): Promise<ManagerReport> {
  const [row] = await db
    .select()
    .from(managerRuns)
    .where(and(eq(managerRuns.key, key), eq(managerRuns.fund, fund)))
  if (row === undefined) {
    throw new StateError(`no manager ${fund} with key ${key}`)
  }
  return row.outcome === null
    ? { done: false, outcome: null }
    : { done: true, outcome: JSON.parse(row.outcome) as unknown }
}

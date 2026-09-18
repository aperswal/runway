import { describe, expect, it } from 'vitest'
import { db, fakeAgent, resetDb, testEnv } from '../test/helpers'
import { managerRuns } from './db/schema'
import { managerReport, reportManager, startManager } from './manager-dispatch'

describe('manager dispatch', () => {
  it('records the run, starts the container named after the fund and hands back a key', async () => {
    await resetDb()
    const { agent, fetch, idFromName, destroy } = fakeAgent([{ status: 202, body: '' }])
    const env = testEnv({ AGENT: agent })
    const key = await startManager({ db, env }, 'quant', '0 6 * * *')
    expect(key).toMatch(/^[0-9a-f-]{36}$/)
    expect(idFromName).toHaveBeenCalledWith('manager-quant')
    expect(destroy).not.toHaveBeenCalled()
    const request = fetch.mock.calls[0]![0]
    expect(request.url).toBe('http://agent/manager')
    expect(request.headers.get('authorization')).toBe('Bearer internal-token-0123456789')
    expect(await request.json()).toEqual({ fund: 'quant', trigger: '0 6 * * *', key })
    expect(await managerReport(db, 'quant', key)).toEqual({ done: false, outcome: null })
    await reportManager({ db, env }, 'quant', key, { result: null, error: null, seen: [] })
    expect(destroy).toHaveBeenCalledTimes(1)
    expect(await managerReport(db, 'quant', key)).toEqual({
      done: true,
      outcome: { result: null, error: null, seen: [] },
    })
    expect(await db.select().from(managerRuns)).toMatchObject([
      { key, fund: 'quant', trigger: '0 6 * * *', finishedAt: expect.stringMatching(/Z$/) },
    ])
  })

  it('refuses a second report, a report for another fund and an unknown key', async () => {
    await resetDb()
    const { agent } = fakeAgent([{ status: 202, body: '' }])
    const env = testEnv({ AGENT: agent })
    const key = await startManager({ db, env }, 'quant', 'manual')
    await expect(reportManager({ db, env }, 'crypto', key, {})).rejects.toThrow(
      `no running manager crypto with key ${key}`,
    )
    await reportManager({ db, env }, 'quant', key, {})
    await expect(reportManager({ db, env }, 'quant', key, {})).rejects.toThrow('no running manager')
    await expect(managerReport(db, 'quant', 'nope')).rejects.toThrow(
      'no manager quant with key nope',
    )
  })

  it('fails loudly and destroys the container when it refuses the run', async () => {
    await resetDb()
    const { agent, destroy } = fakeAgent([{ status: 500, body: 'boom' }])
    await expect(
      startManager({ db, env: testEnv({ AGENT: agent }) }, 'quant', 'manual'),
    ).rejects.toThrow('manager container 500: boom')
    expect(destroy).toHaveBeenCalledTimes(1)
  })
})

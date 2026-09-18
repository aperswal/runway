import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_CONFIG, db, resetDb, stubFetch, jsonBody, headerOf } from '../test/helpers'
import { analyses, lessons, monitors, notes, observations, plain } from './db/schema'
import { parseConfig } from './env'
import { rewritePending } from './rewrite'

const AT = '2026-09-02T12:00:00.000Z'
const withKey = { ...TEST_CONFIG, DEEPINFRA_API_KEY: 'di', DEEPINFRA_API_URL: 'https://di.test' }
const URL = 'https://di.test/v1/openai/chat/completions'
const answer = (content: unknown) => ({
  url: URL,
  method: 'POST',
  body: { choices: [{ message: { content: JSON.stringify(content) } }] },
})

async function seed(): Promise<void> {
  await db
    .insert(notes)
    .values({ fund: 'quant', title: 'RSI<30', body: 'mkt closed', createdAt: AT })
  await db.insert(observations).values([
    {
      fund: 'quant',
      symbol: 'AAPL',
      source: 'bars',
      metric: 'rsi',
      value: 28,
      note: 'oversold',
      createdAt: AT,
    },
    { fund: 'quant', symbol: null, source: 'news', metric: 'mood', note: 'grim', createdAt: AT },
  ])
  await db.insert(analyses).values({
    fund: 'quant',
    kind: 'technical',
    title: 'MA cross',
    body: '50d > 200d',
    figures: {},
    verdict: null,
    createdAt: AT,
  })
  await db.insert(lessons).values({
    fund: 'quant',
    kind: 'psyche',
    lesson: 'Do not widen targets.',
    tradeId: null,
    createdAt: AT,
  })
  await db.insert(monitors).values({
    fund: 'quant',
    symbol: 'AAPL',
    event: 'earnings',
    eventAt: '2026-09-10T00:00:00.000Z',
    watch: 'gap > 5%',
    status: 'armed',
    createdAt: AT,
  })
}

describe('rewritePending', () => {
  beforeEach(resetDb)
  afterEach(() => vi.unstubAllGlobals())

  it('does nothing without a DeepInfra key', async () => {
    const { calls } = stubFetch([])
    await seed()
    expect(await rewritePending(db, parseConfig(TEST_CONFIG))).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it('rewrites every kind once and stores the plain text', async () => {
    const { calls } = stubFetch([answer({ title: 'Plain title', body: 'Plain body' })])
    await seed()
    expect(await rewritePending(db, parseConfig(withKey))).toBe(6)
    expect(calls).toHaveLength(6)
    expect(headerOf(calls[0], 'authorization')).toBe('Bearer di')
    const prompts = calls.map((c) =>
      String((jsonBody(c).messages as { content: string }[])[1]?.content),
    )
    expect(prompts.sort()).toEqual(
      [
        'Title: RSI<30\n\nBody:\nmkt closed',
        'Title: AAPL rsi\n\nBody:\noversold',
        'Title: mood\n\nBody:\ngrim',
        'Title: MA cross\n\nBody:\n50d > 200d',
        'Title: psyche lesson\n\nBody:\nDo not widen targets.',
        'Title: AAPL earnings\n\nBody:\ngap > 5%',
      ].sort(),
    )
    expect(jsonBody(calls[0])).toMatchObject({
      model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      response_format: { type: 'json_object' },
    })
    const rows = await db.select().from(plain)
    const [note] = await db.select({ id: notes.id }).from(notes)
    expect(rows.map((r) => r.kind).sort()).toEqual(
      ['note', 'observation', 'observation', 'analysis', 'lesson', 'monitor'].sort(),
    )
    expect(rows.every((r) => r.title === 'Plain title' && r.body === 'Plain body')).toBe(true)
    expect(rows.every((r) => r.model === 'meta-llama/Llama-3.3-70B-Instruct-Turbo')).toBe(true)
    expect(rows.find((r) => r.kind === 'note')?.sourceId).toBe(note?.id)
    expect(await rewritePending(db, parseConfig(withKey))).toBe(0)
    expect(calls).toHaveLength(6)
  })

  it('uses the production api and a custom model by default', async () => {
    const { calls } = stubFetch([
      {
        url: 'https://api.deepinfra.com/v1/openai/chat/completions',
        method: 'POST',
        body: { choices: [{ message: { content: '{"title":"t","body":"b"}' } }] },
      },
    ])
    await db.insert(notes).values({ fund: 'quant', title: 'a', body: 'b', createdAt: AT })
    const config = parseConfig({ ...TEST_CONFIG, DEEPINFRA_API_KEY: 'di', REWRITE_MODEL: 'small' })
    expect(await rewritePending(db, config)).toBe(1)
    expect(jsonBody(calls[0]).model).toBe('small')
  })

  it('skips items the model could not rewrite and retries them next time', async () => {
    stubFetch([
      { url: URL, method: 'POST', status: 429, body: 'slow down', times: 1 },
      { url: URL, method: 'POST', body: { choices: [] }, times: 1 },
      {
        url: URL,
        method: 'POST',
        body: { choices: [{ message: { content: '{"title":""}' } }] },
        times: 1,
      },
      {
        url: URL,
        method: 'POST',
        body: { choices: [{ message: { content: '{"title":"t","body":"here is why: "}' } }] },
        times: 1,
      },
      answer({ title: 'ok', body: 'fine' }),
    ])
    await db.insert(notes).values([
      { fund: 'quant', title: 'one', body: 'x', createdAt: AT },
      { fund: 'quant', title: 'two', body: 'y', createdAt: AT },
      { fund: 'quant', title: 'three', body: 'z', createdAt: AT },
      { fund: 'quant', title: 'four', body: 'w', createdAt: AT },
    ])
    expect(await rewritePending(db, parseConfig(withKey))).toBe(0)
    expect(await rewritePending(db, parseConfig(withKey))).toBe(4)
    expect(await db.select().from(plain)).toHaveLength(4)
  })
})

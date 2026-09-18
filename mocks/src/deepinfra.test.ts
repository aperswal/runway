import { describe, expect, it } from 'vitest'
import { readJson, setup } from './test-support.ts'

type Completion = { model: string; choices: { message: { content: string } }[] }
const AUTH = { authorization: 'Bearer di' }
const body = (content: string) => ({
  model: 'm',
  messages: [
    { role: 'system', content: 'rewrite' },
    { role: 'user', content },
  ],
})

describe('deepinfra api', () => {
  it('answers a chat completion with a plain rewrite of the prompt', async () => {
    const { call } = setup()
    const res = await call('POST', '/deepinfra/v1/openai/chat/completions', {
      headers: AUTH,
      body: body('Title: RARE stop\n\nBody:\nline one\nline two'),
    })
    expect(res.status).toBe(200)
    const completion = await readJson<Completion>(res)
    expect(completion.model).toBe('m')
    expect(JSON.parse(completion.choices[0]?.message.content ?? '')).toEqual({
      title: 'Plain: RARE stop',
      body: 'Plain: line one\nline two',
    })
    const bare = await readJson<Completion>(
      await call('POST', '/deepinfra/v1/openai/chat/completions', {
        headers: AUTH,
        body: body('x'),
      }),
    )
    expect(JSON.parse(bare.choices[0]?.message.content ?? '')).toEqual({
      title: 'Plain: ',
      body: 'Plain: ',
    })
  })

  it('requires a key, validates the body and 404s elsewhere', async () => {
    const { call } = setup()
    const anon = await call('POST', '/deepinfra/v1/openai/chat/completions', { body: body('x') })
    expect(anon.status).toBe(401)
    const bad = await call('POST', '/deepinfra/v1/openai/chat/completions', {
      headers: AUTH,
      body: { model: 'm' },
    })
    expect(bad.status).toBe(422)
    const missing = await call('GET', '/deepinfra/v1/models', { headers: AUTH })
    expect(missing.status).toBe(404)
  })
})

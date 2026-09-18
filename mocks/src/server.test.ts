import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeps, createHandler } from './router.ts'
import { startServer, toRequest, type RunningServer } from './server.ts'
import type { IncomingMessage } from 'node:http'
import { Readable } from 'node:stream'
import { ALPACA_HEADERS, BASE_CONFIG } from './test-support.ts'

const message = (fields: Record<string, unknown>, chunks: Buffer[] = []): IncomingMessage =>
  Object.assign(Readable.from(chunks), fields) as unknown as IncomingMessage

describe('toRequest', () => {
  it('falls back to GET, localhost and the root path', async () => {
    const request = await toRequest(message({ method: undefined, url: undefined, headers: {} }))
    expect(request.method).toBe('GET')
    expect(request.url).toBe('http://localhost/')
    expect(request.body).toBeNull()
  })

  it('carries the host, path, headers and body', async () => {
    const request = await toRequest(
      message({ method: 'POST', url: '/x/2/tweets?a=1', headers: { host: 'h:1', 'x-a': 'b' } }, [
        Buffer.from('{"te'),
        Buffer.from('xt":"hi"}'),
      ]),
    )
    expect(request.url).toBe('http://h:1/x/2/tweets?a=1')
    expect(request.headers.get('x-a')).toBe('b')
    expect(await request.json()).toEqual({ text: 'hi' })
  })

  it('drops the body of bodyless methods', async () => {
    for (const method of ['GET', 'HEAD']) {
      const request = await toRequest(message({ method, url: '/', headers: {} }))
      expect(request.method).toBe(method)
      expect(request.body).toBeNull()
    }
  })
})

describe('startServer', () => {
  let running: RunningServer | undefined

  afterEach(async () => {
    await running?.close()
    running = undefined
  })

  it('serves the handler over http on an ephemeral port', async () => {
    const onError = vi.fn()
    running = await startServer(createHandler(createDeps(BASE_CONFIG)), { port: 0, onError })
    const base = `http://127.0.0.1:${running.port}`
    const account = await fetch(`${base}/alpaca/v2/account`, { headers: ALPACA_HEADERS })
    expect(account.status).toBe(200)
    expect(account.headers.get('content-type')).toBe('application/json')
    expect(await account.json()).toMatchObject({ cash: '1000.00' })
    const order = await fetch(`${base}/alpaca/v2/orders`, {
      method: 'POST',
      headers: { ...ALPACA_HEADERS, 'content-type': 'application/json' },
      body: JSON.stringify({
        symbol: 'AAPL',
        notional: '10',
        side: 'buy',
        type: 'market',
        time_in_force: 'day',
      }),
    })
    expect(order.status).toBe(200)
    expect(await order.json()).toMatchObject({ status: 'filled' })
    const linkedin = await fetch(`${base}/linkedin/rest/posts`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer t',
        'linkedin-version': '202508',
        'x-restli-protocol-version': '2.0.0',
      },
      body: JSON.stringify({
        author: 'urn:li:person:a',
        commentary: 'hi',
        visibility: 'PUBLIC',
        distribution: {
          feedDistribution: 'MAIN_FEED',
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: 'PUBLISHED',
      }),
    })
    expect(linkedin.status).toBe(201)
    expect(linkedin.headers.get('x-restli-id')).toMatch(/^urn:li:share:/)
    const head = await fetch(`${base}/alpaca/v2/account`, {
      method: 'HEAD',
      headers: ALPACA_HEADERS,
    })
    expect(head.status).toBe(404)
    expect(await head.text()).toBe('')
    expect(onError).not.toHaveBeenCalled()
  })

  it('answers 500 and reports when the handler throws', async () => {
    const onError = vi.fn()
    running = await startServer(() => Promise.reject(new TypeError('broken')), { port: 0, onError })
    const res = await fetch(`http://127.0.0.1:${running.port}/anything`)
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.json()).toEqual({ message: 'internal error' })
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError))
  })

  it('stops listening when closed', async () => {
    const server = await startServer(() => Promise.resolve(new Response(null)), {
      port: 0,
      onError: () => undefined,
    })
    const base = `http://127.0.0.1:${server.port}`
    expect((await fetch(base)).status).toBe(200)
    await server.close()
    await expect(fetch(base)).rejects.toThrow()
  })
})

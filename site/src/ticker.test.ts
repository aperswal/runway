import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertTrade, resetDb, seedFund } from '../test/helpers'
import { FEEDS, parseStream, streamBase, type Ticker } from './ticker'

type Upstream = { server: WebSocket; sent: string[]; url: string }

const stubStreams = (): Upstream[] => {
  const upstreams: Upstream[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const pair = new WebSocketPair()
      const server = pair[1]
      server.accept()
      const up: Upstream = { server, sent: [], url }
      server.addEventListener('message', (e) => up.sent.push(String(e.data)))
      upstreams.push(up)
      return Promise.resolve(new Response(null, { status: 101, webSocket: pair[0] }))
    }),
  )
  return upstreams
}

const ticker = (): DurableObjectNamespace<Ticker> =>
  (env as unknown as { TICKER: DurableObjectNamespace<Ticker> }).TICKER

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20))
const inside = (stub: DurableObjectStub, action: () => void): Promise<void> =>
  runInDurableObject(stub, () => {
    action()
    return Promise.resolve()
  })

const connectClient = async (
  stub: DurableObjectStub,
): Promise<{ socket: WebSocket; received: string[] }> => {
  const res = await stub.fetch('http://ticker/live', { headers: { upgrade: 'websocket' } })
  expect(res.status).toBe(101)
  const socket = res.webSocket!
  socket.accept()
  const received: string[] = []
  socket.addEventListener('message', (e) => received.push(String(e.data)))
  return { socket, received }
}

describe('parseStream', () => {
  it('keeps only tagged messages from an array', () => {
    expect(parseStream('[{"T":"t","S":"AAPL","p":1},{"x":1},null]')).toEqual([
      { T: 't', S: 'AAPL', p: 1 },
    ])
    expect(parseStream('{"T":"t"}')).toEqual([])
  })
  it('defaults to the Alpaca stream host', () => {
    expect(streamBase({})).toBe('https://stream.data.alpaca.markets')
    expect(streamBase({ ALPACA_STREAM_URL: 'https://stream.test' })).toBe('https://stream.test')
  })
  it('routes symbols to the right feed', () => {
    const names = (symbol: string): string[] =>
      FEEDS.filter((f) => f.pick(symbol)).map((f) => f.name)
    expect(names('AAPL')).toEqual(['stocks'])
    expect(names('BTC/USD')).toEqual(['crypto'])
    expect(names('AAPL260116C00190000')).toEqual(['options'])
  })
})

describe('Ticker', () => {
  beforeEach(async () => {
    await resetDb()
    await seedFund()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('refuses plain http requests and drops feeds when an errored client was the last one', async () => {
    const stub = ticker().getByName('plain')
    const res = await stub.fetch('http://ticker/live')
    expect(res.status).toBe(426)
    const close = vi.fn()
    await runInDurableObject(stub, (instance: Ticker) => {
      instance.webSocketError({ close } as unknown as WebSocket)
      return Promise.resolve()
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('ignores ticks without a symbol or price and resubscribes only after authentication', async () => {
    await insertTrade({ symbol: 'AAPL' })
    const upstreams = stubStreams()
    const stub = ticker().getByName('partial')
    const client = await connectClient(stub)
    await settle()
    const stocks = upstreams[0]!
    await runInDurableObject(stub, async (instance: Ticker) => {
      await instance.alarm()
    })
    await inside(stub, () => {
      stocks.server.send(
        '[{"T":"t","S":"AAPL"},{"T":"t","p":1},{"T":"success","msg":"authenticated"}]',
      )
    })
    await settle()
    expect(stocks.sent.map((m) => JSON.parse(m) as { action: string })).toEqual([
      { action: 'auth', key: 'test-key', secret: 'test-secret' },
      { action: 'subscribe', trades: ['AAPL'] },
    ])
    expect(client.received).toEqual(['{"prices":{},"feeds":{"stocks":"connecting"}}'])
    await inside(stub, () => {
      stocks.server.close()
    })
    await settle()
    await runInDurableObject(stub, async (instance: Ticker) => {
      await instance.alarm()
    })
    await settle()
    expect(upstreams).toHaveLength(2)
    client.socket.close()
  })

  it('subscribes upstream per feed, fans ticks out, and snapshots prices for late joiners', async () => {
    await insertTrade({ symbol: 'AAPL' })
    await insertTrade({ symbol: 'BTC/USD', assetClass: 'crypto', status: 'closing' })
    await insertTrade({ symbol: 'MSFT', status: 'pending', orderId: 'o1' })
    const upstreams = stubStreams()
    const stub = ticker().getByName('fanout')
    const first = await connectClient(stub)
    await settle()
    expect(upstreams.map((u) => u.url)).toEqual([
      'https://stream.test/v2/iex',
      'https://stream.test/v1beta3/crypto/us',
    ])
    expect(first.received).toEqual([
      '{"prices":{},"feeds":{"stocks":"connecting","crypto":"connecting"}}',
    ])
    const stocks = upstreams[0]!
    expect(JSON.parse(stocks.sent[0] ?? '')).toEqual({
      action: 'auth',
      key: 'test-key',
      secret: 'test-secret',
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await inside(stub, () => {
      stocks.server.send('[{"T":"success","msg":"connected"}]')
      stocks.server.send('[{"T":"error","code":406,"msg":"connection limit exceeded"}]')
    })
    await settle()
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('error 406: connection limit exceeded'),
    )
    const third = await connectClient(stub)
    await settle()
    expect(third.received[0]).toContain('"stocks":"error 406: connection limit exceeded"')
    third.socket.close()
    await inside(stub, () => {
      stocks.server.send('[{"T":"error"}]')
      stocks.server.send('[{"T":"success","msg":"authenticated"}]')
    })
    await settle()
    expect(JSON.parse(stocks.sent[1] ?? '')).toEqual({ action: 'subscribe', trades: ['AAPL'] })
    await inside(stub, () => {
      stocks.server.send('[{"T":"t","S":"AAPL","p":231.5,"t":"x"},{"T":"q","S":"AAPL"}]')
      stocks.server.send('not json')
    })
    await settle()
    expect(first.received.at(-1)).toBe('{"s":"AAPL","p":231.5}')
    const second = await connectClient(stub)
    await settle()
    expect(second.received[0]).toBe(
      '{"prices":{"AAPL":231.5},"feeds":{"stocks":"live","crypto":"connecting"}}',
    )
    await insertTrade({ symbol: 'NVDA' })
    await runInDurableObject(stub, async (instance: Ticker) => {
      await instance.alarm()
    })
    await settle()
    expect(JSON.parse(stocks.sent.at(-1) ?? '')).toEqual({
      action: 'subscribe',
      trades: ['NVDA'],
    })
    first.socket.close()
    second.socket.close()
    await settle()
    await runInDurableObject(stub, async (instance: Ticker) => {
      await instance.alarm()
    })
    await settle()
    await inside(stub, () => {
      expect(stocks.server.readyState).toBe(WebSocket.READY_STATE_CLOSED)
    })
  })

  it('unsubscribes symbols that were closed and survives a failed upstream', async () => {
    await insertTrade({ symbol: 'AAPL' })
    const upstreams = stubStreams()
    const stub = ticker().getByName('unsub')
    const client = await connectClient(stub)
    await settle()
    const stocks = upstreams[0]!
    await inside(stub, () => {
      stocks.server.send('[{"T":"success","msg":"authenticated"}]')
    })
    await settle()
    await resetDb()
    await seedFund()
    await insertTrade({ symbol: 'TSLA' })
    await runInDurableObject(stub, async (instance: Ticker) => {
      await instance.alarm()
    })
    await settle()
    expect(stocks.sent.slice(-2).map((m) => JSON.parse(m) as unknown)).toEqual([
      { action: 'subscribe', trades: ['TSLA'] },
      { action: 'unsubscribe', trades: ['AAPL'] },
    ])
    client.socket.close()
    await settle()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 500 }))),
    )
    const again = ticker().getByName('broken')
    await insertTrade({ symbol: 'AMD' })
    await expect(
      again.fetch('http://ticker/live', { headers: { upgrade: 'websocket' } }),
    ).rejects.toThrow('alpaca stream 500: stocks: no websocket')
  })
})

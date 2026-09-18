import { DurableObject } from 'cloudflare:workers'
import { createDb } from './db/client'
import { parseConfig, type Bindings, type Config } from './env'
import { ExternalServiceError } from './errors'
import { errorMessage, log } from './log'
import { isCrypto, isOption } from './symbols'
import { activeTrades } from './trades'

const DEFAULT_STREAM_URL = 'https://stream.data.alpaca.markets'
const HTTP_UPGRADE_REQUIRED = 426
const HTTP_SWITCHING = 101
const RESUBSCRIBE_MS = 60_000

type Feed = { name: string; path: string; pick: (symbol: string) => boolean }

export const FEEDS: Feed[] = [
  { name: 'stocks', path: '/v2/iex', pick: (s) => !isCrypto(s) && !isOption(s) },
  { name: 'crypto', path: '/v1beta3/crypto/us', pick: isCrypto },
  { name: 'options', path: '/v1beta1/indicative', pick: isOption },
]

type Upstream = { socket: WebSocket; subscribed: Set<string>; authenticated: boolean; note: string }
type StreamConfig = Pick<Config, 'ALPACA_API_KEY' | 'ALPACA_API_SECRET' | 'ALPACA_STREAM_URL'>
type StreamMessage = { T: string; msg?: string; S?: string; p?: number; code?: number }

export const parseStream = (text: string): StreamMessage[] => {
  const raw: unknown = JSON.parse(text)
  return Array.isArray(raw)
    ? raw.filter((m): m is StreamMessage => typeof m === 'object' && m !== null && 'T' in m)
    : []
}

export const streamBase = (config: Pick<Config, 'ALPACA_STREAM_URL'>): string =>
  config.ALPACA_STREAM_URL ?? DEFAULT_STREAM_URL

const feedState = (u: Upstream): string => {
  if (u.authenticated) {
    return 'live'
  }
  return u.note === '' ? 'connecting' : u.note
}

const tick = (message: StreamMessage): { symbol: string; price: number } | null =>
  message.T === 't' && typeof message.S === 'string' && typeof message.p === 'number'
    ? { symbol: message.S, price: message.p }
    : null

export class Ticker extends DurableObject<Bindings> {
  private readonly upstreams = new Map<string, Upstream>()
  private readonly prices = new Map<string, number>()

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a websocket', { status: HTTP_UPGRADE_REQUIRED })
    }
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server)
    await this.refresh()
    server.send(
      JSON.stringify({ prices: Object.fromEntries(this.prices), feeds: this.feedStates() }),
    )
    return new Response(null, { status: HTTP_SWITCHING, webSocket: client })
  }

  override webSocketClose(ws: WebSocket): void {
    ws.close()
    this.dropIfIdle()
  }

  override webSocketError(ws: WebSocket): void {
    ws.close()
    this.dropIfIdle()
  }

  override async alarm(): Promise<void> {
    if (!this.dropIfIdle()) {
      await this.refresh()
    }
  }

  private feedStates(): Record<string, string> {
    return Object.fromEntries([...this.upstreams].map(([name, u]) => [name, feedState(u)]))
  }

  private dropIfIdle(): boolean {
    if (this.ctx.getWebSockets().length > 0) {
      return false
    }
    for (const upstream of this.upstreams.values()) {
      upstream.socket.close()
    }
    this.upstreams.clear()
    return true
  }

  private async refresh(): Promise<void> {
    const config = parseConfig(this.env)
    const symbols = (await activeTrades(createDb(this.env.DB)))
      .filter((t) => t.status !== 'pending')
      .map((t) => t.symbol)
    for (const feed of FEEDS) {
      const wanted = new Set(symbols.filter(feed.pick))
      if (wanted.size > 0) {
        await this.subscribe(feed, wanted, config)
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + RESUBSCRIBE_MS)
  }

  private async subscribe(feed: Feed, wanted: Set<string>, config: StreamConfig): Promise<void> {
    const upstream = this.upstreams.get(feed.name) ?? (await this.open(feed, config))
    if (!upstream.authenticated) {
      upstream.subscribed = wanted
      return
    }
    const add = [...wanted].filter((s) => !upstream.subscribed.has(s))
    const drop = [...upstream.subscribed].filter((s) => !wanted.has(s))
    if (add.length > 0) {
      upstream.socket.send(JSON.stringify({ action: 'subscribe', trades: add }))
    }
    if (drop.length > 0) {
      upstream.socket.send(JSON.stringify({ action: 'unsubscribe', trades: drop }))
    }
    upstream.subscribed = wanted
  }

  private async open(feed: Feed, config: StreamConfig): Promise<Upstream> {
    const res = await fetch(`${streamBase(config)}${feed.path}`, {
      headers: { upgrade: 'websocket' },
    })
    const socket = res.webSocket
    if (socket === null) {
      throw new ExternalServiceError('alpaca stream', res.status, `${feed.name}: no websocket`)
    }
    socket.accept()
    const upstream: Upstream = { socket, subscribed: new Set(), authenticated: false, note: '' }
    this.upstreams.set(feed.name, upstream)
    socket.addEventListener('message', (event) => {
      this.onUpstream(feed, upstream, String(event.data))
    })
    const forget = (): void => {
      this.upstreams.delete(feed.name)
    }
    socket.addEventListener('close', forget)
    socket.addEventListener('error', forget)
    socket.send(
      JSON.stringify({
        action: 'auth',
        key: config.ALPACA_API_KEY,
        secret: config.ALPACA_API_SECRET,
      }),
    )
    return upstream
  }

  private onUpstream(feed: Feed, upstream: Upstream, text: string): void {
    let messages: StreamMessage[]
    try {
      messages = parseStream(text)
    } catch (error) {
      log.error({ message: 'stream parse failed', feed: feed.name, error: errorMessage(error) })
      return
    }
    for (const message of messages) {
      this.onMessage(upstream, message)
    }
  }

  private onMessage(upstream: Upstream, message: StreamMessage): void {
    if (message.T === 'error') {
      upstream.note = `error ${message.code ?? 0}: ${message.msg ?? ''}`
      log.error({ message: 'stream error', detail: upstream.note })
      return
    }
    if (message.T === 'success' && message.msg === 'authenticated') {
      upstream.authenticated = true
      upstream.socket.send(
        JSON.stringify({ action: 'subscribe', trades: [...upstream.subscribed] }),
      )
      return
    }
    const trade = tick(message)
    if (trade !== null) {
      this.prices.set(trade.symbol, trade.price)
      this.broadcast(JSON.stringify({ s: trade.symbol, p: trade.price }))
    }
  }

  private broadcast(payload: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      ws.send(payload)
    }
  }
}

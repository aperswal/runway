import { z } from 'zod'
import { ExternalServiceError } from '../errors'

export type XCredentials = {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessSecret: string
}

export const X_API_URL = 'https://api.x.com'
const MS_PER_SECOND = 1000
const HEX = 16

const encode = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(HEX).toUpperCase()}`,
  )

export type OauthSecrets = { consumerSecret: string; tokenSecret: string }

export const signingKey = (secrets: OauthSecrets): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${encode(secrets.consumerSecret)}&${encode(secrets.tokenSecret)}`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )

export async function oauthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  secrets: OauthSecrets,
): Promise<string> {
  const normalized = Object.entries(params)
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .sort()
    .join('&')
  const base = `${method.toUpperCase()}&${encode(url)}&${encode(normalized)}`
  const key = await signingKey(secrets)
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(base))
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}

export async function oauthHeader(
  method: string,
  url: string,
  creds: XCredentials,
): Promise<string> {
  const params: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomUUID().replaceAll('-', ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / MS_PER_SECOND)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  }
  const secrets = { consumerSecret: creds.apiSecret, tokenSecret: creds.accessSecret }
  params.oauth_signature = await oauthSignature(method, url, params, secrets)
  const header = Object.entries(params)
    .map(([k, v]) => `${encode(k)}="${encode(v)}"`)
    .join(', ')
  return `OAuth ${header}`
}

const responseSchema = z.object({ data: z.object({ id: z.string() }) })

type Payload = { body: BodyInit; headers?: Record<string, string> }

async function xCall(url: string, creds: XCredentials, payload: Payload): Promise<string> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...payload.headers, authorization: await oauthHeader('POST', url, creds) },
    body: payload.body,
  })
  const body = await res.text()
  if (!res.ok) {
    throw new ExternalServiceError('x', res.status, body)
  }
  const parsed = responseSchema.safeParse(JSON.parse(body))
  if (!parsed.success) {
    throw new ExternalServiceError('x', res.status, `response without id: ${body}`)
  }
  return parsed.data.data.id
}

export function uploadXMedia(
  image: Uint8Array,
  creds: XCredentials,
  baseUrl: string = X_API_URL,
): Promise<string> {
  const form = new FormData()
  form.set('media', new Blob([image], { type: 'image/png' }), 'chart.png')
  form.set('media_category', 'tweet_image')
  return xCall(`${baseUrl}/2/media/upload`, creds, { body: form })
}

export async function postToX(
  text: string,
  image: Uint8Array,
  creds: XCredentials,
  baseUrl: string = X_API_URL,
): Promise<string> {
  const mediaId = await uploadXMedia(image, creds, baseUrl)
  return xCall(`${baseUrl}/2/tweets`, creds, {
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
  })
}

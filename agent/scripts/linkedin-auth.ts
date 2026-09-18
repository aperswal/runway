import http from 'node:http'
import { z } from 'zod'

const env = z
  .object({ LINKEDIN_CLIENT_ID: z.string().min(1), LINKEDIN_CLIENT_SECRET: z.string().min(1) })
  .parse(process.env)

const PORT = 3939
const MS_PER_SECOND = 1000
const DATE_LENGTH = 10
const HTTP = { ok: 200, badRequest: 400, notFound: 404 } as const
const redirect = `http://localhost:${PORT}/callback`
const state = crypto.randomUUID()
const authorize = new URL('https://www.linkedin.com/oauth/v2/authorization')
authorize.search = new URLSearchParams({
  response_type: 'code',
  client_id: env.LINKEDIN_CLIENT_ID,
  redirect_uri: redirect,
  state,
  scope: 'openid profile w_member_social',
}).toString()

console.log(`Open this URL, approve, and wait:\n\n${authorize.toString()}\n`)

async function exchange(code: string): Promise<string> {
  const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirect,
      client_id: env.LINKEDIN_CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET,
    }),
  })
  if (!tokenRes.ok) {
    return `LinkedIn token exchange failed ${tokenRes.status}: ${await tokenRes.text()}`
  }
  const token = z
    .object({ access_token: z.string(), expires_in: z.number() })
    .parse(await tokenRes.json())
  const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { authorization: `Bearer ${token.access_token}` },
  })
  if (!meRes.ok) {
    return `LinkedIn userinfo failed ${meRes.status}: ${await meRes.text()}`
  }
  const me = z.object({ sub: z.string() }).parse(await meRes.json())
  const expires = new Date(Date.now() + token.expires_in * MS_PER_SECOND)
    .toISOString()
    .slice(0, DATE_LENGTH)
  return `LINKEDIN_ACCESS_TOKEN=${token.access_token}\nLINKEDIN_PERSON_URN=urn:li:person:${me.sub}\n\nExpires ${expires}. Put both lines in .env, then run pnpm secrets.`
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const code = url.searchParams.get('code')
  if (url.pathname !== '/callback') {
    res.writeHead(HTTP.notFound).end()
    return
  }
  if (url.searchParams.get('state') !== state || code === null) {
    res
      .writeHead(HTTP.badRequest)
      .end('bad state or missing code; still waiting for the real redirect')
    return
  }
  void exchange(code).then((message) => {
    console.log(`\n${message}`)
    res.writeHead(HTTP.ok).end('Done. Back to the terminal.')
    server.close()
  })
})

server.listen(PORT)

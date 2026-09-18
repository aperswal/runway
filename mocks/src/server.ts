import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { STATUS } from './errors.ts'
import { json } from './http.ts'
import type { RequestHandler } from './router.ts'

export type ServerOptions = { port: number; onError: (error: unknown) => void }
export type RunningServer = { port: number; close: () => Promise<void> }

const BODYLESS_METHODS = ['GET', 'HEAD']

export async function toRequest(req: http.IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  const method = req.method ?? 'GET'
  const host = req.headers.host ?? 'localhost'
  const init: RequestInit = { method, headers: req.headers as Record<string, string> }
  if (!BODYLESS_METHODS.includes(method)) {
    init.body = Buffer.concat(chunks)
  }
  return new Request(`http://${host}${req.url ?? ''}`, init)
}

async function respond(res: http.ServerResponse, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers))
  res.end(Buffer.from(await response.arrayBuffer()))
}

export function startServer(
  handler: RequestHandler,
  options: ServerOptions,
): Promise<RunningServer> {
  const server = http.createServer((req, res) => {
    toRequest(req)
      .then(handler)
      .catch((error: unknown) => {
        options.onError(error)
        return json({ message: 'internal error' }, STATUS.internalError)
      })
      .then((response) => respond(res, response))
      .catch(options.onError)
  })
  return new Promise((resolve) => {
    server.listen(options.port, () => {
      const { port } = server.address() as AddressInfo
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

import { loadConfig } from './env.ts'
import { createDeps, createHandler } from './router.ts'
import { startServer } from './server.ts'

const config = loadConfig()
const server = await startServer(createHandler(createDeps(config)), {
  port: config.port,
  onError: (error) => {
    console.error(JSON.stringify({ level: 'error', error: String(error) }))
  },
})
console.log(JSON.stringify({ level: 'info', event: 'listening', port: server.port }))

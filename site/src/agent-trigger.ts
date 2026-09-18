import { getContainer } from '@cloudflare/containers'
import { parseConfig, type Bindings } from './env'
import { ExternalServiceError } from './errors'

const HTTP_ACCEPTED = 202

export async function startAgentRun(
  env: Bindings & Record<string, unknown>,
  trigger: string,
): Promise<string> {
  const config = parseConfig(env)
  const res = await getContainer(env.AGENT, 'agent').fetch(
    new Request('http://agent/run', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({ trigger }),
    }),
  )
  const body = await res.text()
  if (res.status !== HTTP_ACCEPTED) {
    throw new ExternalServiceError('agent', res.status, body)
  }
  return body
}

export async function agentHealth(env: Bindings): Promise<string> {
  const res = await getContainer(env.AGENT, 'agent').fetch(new Request('http://agent/health'))
  return res.text()
}

export async function restartAgent(env: Bindings): Promise<void> {
  await getContainer(env.AGENT, 'agent').destroy()
}

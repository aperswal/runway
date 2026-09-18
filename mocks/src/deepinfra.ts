import { z } from 'zod'
import { STATUS } from './errors.ts'
import { bearerToken, dispatch, json, type Handler, type MockRequest, type Route } from './http.ts'

const completionSchema = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
})

const TITLE = /^Title: (.*)$/m
const BODY = /Body:\n([\s\S]*)$/

const plainOf = (prompt: string): { title: string; body: string } => ({
  title: `Plain: ${TITLE.exec(prompt)?.[1] ?? ''}`,
  body: `Plain: ${BODY.exec(prompt)?.[1] ?? ''}`,
})

const unauthorized = (): Response =>
  json({ detail: { error: 'invalid api key' } }, STATUS.unauthorized)

const notFound = (): Response => json({ detail: 'Not Found' }, STATUS.notFound)

export function createDeepInfra(): Handler {
  const routes: Route[] = [
    {
      method: 'POST',
      pattern: '/v1/openai/chat/completions',
      handle: (request: MockRequest) => {
        if (bearerToken(request.headers) === null) {
          return unauthorized()
        }
        const parsed = completionSchema.safeParse(request.body)
        if (!parsed.success) {
          return json({ detail: parsed.error.issues }, STATUS.unprocessable)
        }
        const prompt = parsed.data.messages.reduce((_, m) => m.content, '')
        const content = JSON.stringify(plainOf(prompt))
        return json({
          id: 'chatcmpl-mock',
          model: parsed.data.model,
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: prompt.length, completion_tokens: content.length },
        })
      },
    },
  ]
  return (request) => dispatch(routes, request, notFound)
}

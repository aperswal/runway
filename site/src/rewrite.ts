import { desc, eq, notInArray, type AnyColumn, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db/client'
import { analyses, lessons, monitors, notes, observations, plain } from './db/schema'
import type { Config } from './env'
import { ExternalServiceError } from './errors'
import { errorMessage, log } from './log'
import type { PlainKind, PlainText } from './plain'
import { nowIso } from './time'

const DEEPINFRA_API_URL = 'https://api.deepinfra.com'
const DEFAULT_REWRITE_MODEL = 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
const PER_KIND = 10
const MAX_TOKENS = 900
const TEMPERATURE = 0.2

const SYSTEM = [
  'You rewrite notes written by an automated trading fund manager so a general reader understands them.',
  'Use plain words. Keep every number, ticker, date, price, percentage and decision exactly.',
  'Explain a piece of jargon in a few words the first time it appears instead of dropping it.',
  'Write full sentences, never shorthand or abbreviations, but stay concise: no filler, no repetition.',
  'Keep the original structure (paragraphs stay paragraphs, lists stay lists). Do not add opinions or facts.',
  'If the source is only a headline, a data line or raw script output, say what it is (for example: a news scan found the headline "...") and do not turn it into an explanation. Never end the body with a colon or with a promise of something that does not follow.',
  'Reply with JSON only: {"title": string, "body": string}. Keep the title under 80 characters.',
].join(' ')

type Source = { id: number; title: string; body: string }

const missing = (db: Db, kind: PlainKind, id: AnyColumn): SQL =>
  notInArray(id, db.select({ id: plain.sourceId }).from(plain).where(eq(plain.kind, kind)))

const LOADERS: Record<PlainKind, (db: Db) => Promise<Source[]>> = {
  note: (db) =>
    db
      .select({ id: notes.id, title: notes.title, body: notes.body })
      .from(notes)
      .where(missing(db, 'note', notes.id))
      .orderBy(desc(notes.createdAt))
      .limit(PER_KIND),
  observation: (db) =>
    db
      .select({
        id: observations.id,
        symbol: observations.symbol,
        metric: observations.metric,
        body: observations.note,
      })
      .from(observations)
      .where(missing(db, 'observation', observations.id))
      .orderBy(desc(observations.createdAt))
      .limit(PER_KIND)
      .then((rows) =>
        rows.map((o) => ({
          id: o.id,
          title: `${o.symbol === null ? '' : `${o.symbol} `}${o.metric}`,
          body: o.body,
        })),
      ),
  analysis: (db) =>
    db
      .select({ id: analyses.id, title: analyses.title, body: analyses.body })
      .from(analyses)
      .where(missing(db, 'analysis', analyses.id))
      .orderBy(desc(analyses.createdAt))
      .limit(PER_KIND),
  lesson: (db) =>
    db
      .select({ id: lessons.id, kind: lessons.kind, body: lessons.lesson })
      .from(lessons)
      .where(missing(db, 'lesson', lessons.id))
      .orderBy(desc(lessons.createdAt))
      .limit(PER_KIND)
      .then((rows) => rows.map((l) => ({ id: l.id, title: `${l.kind} lesson`, body: l.body }))),
  monitor: (db) =>
    db
      .select({
        id: monitors.id,
        symbol: monitors.symbol,
        event: monitors.event,
        body: monitors.watch,
      })
      .from(monitors)
      .where(missing(db, 'monitor', monitors.id))
      .orderBy(desc(monitors.createdAt))
      .limit(PER_KIND)
      .then((rows) =>
        rows.map((m) => ({ id: m.id, title: `${m.symbol} ${m.event}`, body: m.body })),
      ),
}

const completion = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
})
const complete = (body: string): boolean => !body.trim().endsWith(':')
const rewritten = z.object({
  title: z.string().min(1),
  body: z.string().min(1).refine(complete, 'ends with a colon'),
})

type Rewriter = { key: string; url: string; model: string }

const rewriter = (config: Config): Rewriter | null =>
  config.DEEPINFRA_API_KEY === undefined
    ? null
    : {
        key: config.DEEPINFRA_API_KEY,
        url: config.DEEPINFRA_API_URL ?? DEEPINFRA_API_URL,
        model: config.REWRITE_MODEL ?? DEFAULT_REWRITE_MODEL,
      }

async function rewriteText(source: Source, r: Rewriter): Promise<PlainText> {
  const res = await fetch(`${r.url}/v1/openai/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${r.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: r.model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Title: ${source.title}\n\nBody:\n${source.body}` },
      ],
      response_format: { type: 'json_object' },
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    }),
  })
  const body = await res.text()
  if (!res.ok) {
    throw new ExternalServiceError('deepinfra', res.status, body)
  }
  const parsed = completion.safeParse(JSON.parse(body))
  const content = parsed.success ? parsed.data.choices[0]?.message.content : undefined
  const text = rewritten.safeParse(content === undefined ? null : JSON.parse(content))
  if (!text.success) {
    throw new ExternalServiceError('deepinfra', res.status, `unusable rewrite: ${body}`)
  }
  return text.data
}

async function rewriteOne(db: Db, kind: PlainKind, source: Source, r: Rewriter): Promise<boolean> {
  try {
    const text = await rewriteText(source, r)
    await db
      .insert(plain)
      .values({ kind, sourceId: source.id, ...text, model: r.model, createdAt: nowIso() })
    return true
  } catch (error) {
    log.error({ message: 'rewrite failed', kind, id: source.id, error: errorMessage(error) })
    return false
  }
}

export async function rewritePending(db: Db, config: Config): Promise<number> {
  const r = rewriter(config)
  if (r === null) {
    return 0
  }
  const kinds = Object.keys(LOADERS) as PlainKind[]
  const results = await Promise.all(
    kinds.map(async (kind) => {
      const sources = await LOADERS[kind](db)
      return Promise.all(sources.map((source) => rewriteOne(db, kind, source, r)))
    }),
  )
  return results.flat().filter(Boolean).length
}

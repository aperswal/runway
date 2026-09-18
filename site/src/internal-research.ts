import { Hono } from 'hono'
import { z } from 'zod'
import { analysisInput, analysisQuery, listAnalyses, recordAnalysis } from './analyses'
import type { Deps } from './deps'
import type { Bindings } from './env'
import { parseBody } from './parse'
import { rewritePending } from './rewrite'
import {
  createMonitor,
  listMonitors,
  monitorInput,
  monitorQuery,
  resolveInput,
  resolveMonitor,
} from './monitors'
import {
  listNotes,
  listObservations,
  lessonInput,
  listLessons,
  noteInput,
  observationInput,
  recordLesson,
  recordNote,
  recordObservation,
  researchQuery,
} from './research'

type Env = { Bindings: Bindings; Variables: { deps: Deps } }

const HTTP_CREATED = 201
const idParam = z.coerce.number().int().positive()

export const internalResearch = new Hono<Env>()

internalResearch.get('/analyses', async (c) =>
  c.json(await listAnalyses(c.var.deps.db, parseBody(analysisQuery, c.req.query()))),
)

internalResearch.post('/analyses', async (c) => {
  const input = parseBody(analysisInput, await c.req.json())
  return c.json(await recordAnalysis(c.var.deps.db, input), HTTP_CREATED)
})

internalResearch.get('/observations', async (c) =>
  c.json(await listObservations(c.var.deps.db, parseBody(researchQuery, c.req.query()))),
)

internalResearch.post('/observations', async (c) => {
  const input = parseBody(observationInput, await c.req.json())
  return c.json(await recordObservation(c.var.deps.db, input), HTTP_CREATED)
})

internalResearch.get('/lessons', async (c) =>
  c.json(await listLessons(c.var.deps.db, parseBody(researchQuery, c.req.query()))),
)

internalResearch.post('/lessons', async (c) => {
  const input = parseBody(lessonInput, await c.req.json())
  return c.json(await recordLesson(c.var.deps.db, input), HTTP_CREATED)
})

internalResearch.get('/notes', async (c) =>
  c.json(await listNotes(c.var.deps.db, parseBody(researchQuery, c.req.query()))),
)

internalResearch.post('/rewrite', async (c) =>
  c.json({ rewritten: await rewritePending(c.var.deps.db, c.var.deps.config) }),
)

internalResearch.post('/notes', async (c) => {
  const input = parseBody(noteInput, await c.req.json())
  return c.json(await recordNote(c.var.deps.db, input), HTTP_CREATED)
})

internalResearch.get('/monitors', async (c) =>
  c.json(await listMonitors(c.var.deps.db, parseBody(monitorQuery, c.req.query()))),
)

internalResearch.post('/monitors', async (c) => {
  const input = parseBody(monitorInput, await c.req.json())
  return c.json(await createMonitor(c.var.deps.db, input, new Date()), HTTP_CREATED)
})

internalResearch.patch('/monitors/:id', async (c) => {
  const id = parseBody(idParam, c.req.param('id'))
  const input = parseBody(resolveInput, await c.req.json())
  return c.json(await resolveMonitor(c.var.deps.db, id, input.outcome))
})

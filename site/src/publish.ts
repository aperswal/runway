import { and, eq } from 'drizzle-orm'
import type { Db } from './db/client'
import { posts, trades } from './db/schema'
import type { Config, PostJob } from './env'
import { chartImage } from './chart-image'
import { StateError } from './errors'
import { errorMessage } from './log'
import { isPublishedExit, postText } from './posts'
import { postToLinkedIn } from './social/linkedin'
import { postToX } from './social/x'
import { nowIso } from './time'

type Network = 'x' | 'linkedin'
type Publisher = (text: string, image: Uint8Array) => Promise<string>

export function publishers(config: Config): Partial<Record<Network, Publisher>> {
  const out: Partial<Record<Network, Publisher>> = {}
  if (config.X_API_KEY !== undefined) {
    const creds = {
      apiKey: config.X_API_KEY,
      apiSecret: config.X_API_SECRET ?? '',
      accessToken: config.X_ACCESS_TOKEN ?? '',
      accessSecret: config.X_ACCESS_SECRET ?? '',
    }
    out.x = (text, image) => postToX(text, image, creds, config.X_API_URL)
  }
  if (config.LINKEDIN_ACCESS_TOKEN !== undefined) {
    const creds = {
      accessToken: config.LINKEDIN_ACCESS_TOKEN,
      personUrn: config.LINKEDIN_PERSON_URN ?? '',
    }
    out.linkedin = (text, image) => postToLinkedIn(text, image, creds, config.LINKEDIN_API_URL)
  }
  return out
}

export async function publishTrade(db: Db, config: Config, job: PostJob): Promise<string[]> {
  const [trade] = await db.select().from(trades).where(eq(trades.id, job.tradeId))
  if (trade === undefined) {
    throw new StateError(`post job for unknown trade ${job.tradeId}`)
  }
  if (job.kind === 'sell' && !isPublishedExit(trade)) {
    return []
  }
  const targets = Object.entries(publishers(config)) as [Network, Publisher][]
  if (targets.length === 0) {
    return []
  }
  const text = postText(trade, job.kind)
  const image = await chartImage(db, new Date())
  return publishAll(db, job, targets, { text, image })
}

async function publishAll(
  db: Db,
  job: PostJob,
  targets: [Network, Publisher][],
  content: { text: string; image: Uint8Array },
): Promise<string[]> {
  const failures: string[] = []
  for (const [network, publish] of targets) {
    if (await alreadyPosted(db, job, network)) {
      continue
    }
    const failure = await publishOne(db, job, { network, publish, ...content })
    if (failure !== null) {
      failures.push(failure)
    }
  }
  return failures
}

type Attempt = { network: Network; publish: Publisher; text: string; image: Uint8Array }

async function publishOne(
  db: Db,
  job: PostJob,
  { network, publish, text, image }: Attempt,
): Promise<string | null> {
  try {
    const externalId = await publish(text, image)
    await db
      .insert(posts)
      .values({ ...job, network, status: 'posted', externalId, createdAt: nowIso() })
    return null
  } catch (error) {
    const message = errorMessage(error)
    await db
      .insert(posts)
      .values({ ...job, network, status: 'failed', error: message, createdAt: nowIso() })
    return `${network}: ${message}`
  }
}

async function alreadyPosted(db: Db, job: PostJob, network: Network): Promise<boolean> {
  const [row] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.tradeId, job.tradeId),
        eq(posts.kind, job.kind),
        eq(posts.network, network),
        eq(posts.status, 'posted'),
      ),
    )
  return row !== undefined
}

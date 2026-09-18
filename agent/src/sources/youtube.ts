import { z } from 'zod'
import type { SourceKeys } from '../env.ts'
import { requireKey } from '../env.ts'
import { SourceError } from '../errors.ts'
import type { Flags } from './args.ts'
import { intFlag, requireFlag } from './args.ts'
import { fetchJson, fetchText, withQuery } from './http.ts'
import type { Source } from './source.ts'
import { decodeEntities, stripHtml } from './text.ts'

const API_URL = 'https://www.googleapis.com/youtube/v3'
const WATCH_URL = 'https://www.youtube.com/watch?v='
const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player'
const ANDROID_CLIENT = { clientName: 'ANDROID', clientVersion: '20.10.38' }
const ANDROID_USER_AGENT = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip'
const DEFAULT_SEARCH_MAX = 10
const DEFAULT_COMMENTS_MAX = 50
const DEFAULT_LANGUAGE = 'en'

const searchSchema = z.object({
  items: z.array(
    z.object({
      id: z.object({ videoId: z.string() }),
      snippet: z.object({
        title: z.string(),
        description: z.string(),
        channelTitle: z.string(),
        publishedAt: z.string(),
      }),
    }),
  ),
})

const commentsSchema = z.object({
  items: z.array(
    z.object({
      snippet: z.object({
        totalReplyCount: z.number(),
        topLevelComment: z.object({
          snippet: z.object({
            authorDisplayName: z.string(),
            textOriginal: z.string(),
            likeCount: z.number(),
            publishedAt: z.string(),
          }),
        }),
      }),
    }),
  ),
})

const trackSchema = z.object({
  baseUrl: z.string(),
  languageCode: z.string(),
  kind: z.string().optional(),
})
const playerSchema = z.object({
  playabilityStatus: z.object({ status: z.string(), reason: z.string().optional() }),
  captions: z
    .object({ playerCaptionsTracklistRenderer: z.object({ captionTracks: z.array(trackSchema) }) })
    .optional(),
})
type Track = z.infer<typeof trackSchema>
type Player = z.infer<typeof playerSchema>

type YouTubeVideo = {
  videoId: string
  url: string
  title: string
  description: string
  channel: string
  publishedAt: string
}

type YouTubeComment = {
  author: string
  text: string
  likes: number
  replies: number
  publishedAt: string
}

type YouTubeTranscript = {
  videoId: string
  language: string
  generated: boolean
  text: string
}

const api = <T>(
  path: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
  key: string,
): Promise<T> =>
  fetchJson(withQuery(`${API_URL}/${path}`, params), schema, { headers: { 'x-goog-api-key': key } })

async function search(flags: Flags, keys: SourceKeys): Promise<YouTubeVideo[]> {
  const params = {
    part: 'snippet',
    type: 'video',
    q: requireFlag(flags, 'q'),
    maxResults: String(intFlag(flags, 'max', DEFAULT_SEARCH_MAX)),
  }
  const result = await api('search', params, searchSchema, requireKey(keys, 'YOUTUBE_API_KEY'))
  return result.items.map((item) => ({
    videoId: item.id.videoId,
    url: `${WATCH_URL}${item.id.videoId}`,
    title: decodeEntities(item.snippet.title),
    description: item.snippet.description,
    channel: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
  }))
}

async function comments(flags: Flags, keys: SourceKeys): Promise<YouTubeComment[]> {
  const params = {
    part: 'snippet',
    videoId: requireFlag(flags, 'video'),
    maxResults: String(intFlag(flags, 'max', DEFAULT_COMMENTS_MAX)),
    order: 'relevance',
    textFormat: 'plainText',
  }
  const key = requireKey(keys, 'YOUTUBE_API_KEY')
  const result = await api('commentThreads', params, commentsSchema, key)
  return result.items.map((item) => ({
    author: item.snippet.topLevelComment.snippet.authorDisplayName,
    text: item.snippet.topLevelComment.snippet.textOriginal,
    likes: item.snippet.topLevelComment.snippet.likeCount,
    replies: item.snippet.totalReplyCount,
    publishedAt: item.snippet.topLevelComment.snippet.publishedAt,
  }))
}

function captionText(xml: string): string {
  return [...xml.matchAll(/(?<=<(?:p|text)\b[^>]*>)[\s\S]*?(?=<\/(?:p|text)>)/g)]
    .map((match) => stripHtml(match[0]).replace(/\n/g, ' '))
    .filter((line) => line.length > 0)
    .join(' ')
}

const tracksOf = (player: Player): Track[] =>
  player.captions?.playerCaptionsTracklistRenderer.captionTracks ?? []

function pickTrack(player: Player, videoId: string, language: string): Track {
  if (player.playabilityStatus.status !== 'OK') {
    const reason = player.playabilityStatus.reason ?? player.playabilityStatus.status
    throw new SourceError(`Video ${videoId} is not playable: ${reason}`)
  }
  const tracks = tracksOf(player)
  const track = tracks.find((candidate) => candidate.languageCode === language) ?? tracks[0]
  if (track === undefined) {
    throw new SourceError(`Video ${videoId} has no captions`)
  }
  return track
}

async function transcript(flags: Flags): Promise<YouTubeTranscript> {
  const videoId = requireFlag(flags, 'video')
  const player = await fetchJson(PLAYER_URL, playerSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': ANDROID_USER_AGENT },
    body: JSON.stringify({ context: { client: ANDROID_CLIENT }, videoId }),
  })
  const track = pickTrack(player, videoId, flags.lang ?? DEFAULT_LANGUAGE)
  const headers = { 'user-agent': ANDROID_USER_AGENT }
  const text = captionText(await fetchText(track.baseUrl, { headers }))
  if (text.length === 0) {
    throw new SourceError(`Video ${videoId} returned an empty transcript`)
  }
  return { videoId, language: track.languageCode, generated: track.kind === 'asr', text }
}

export const youtube: Source = {
  name: 'youtube',
  commands: [
    {
      name: 'search',
      usage: 'youtube search --q "<query>" [--max 10]',
      about: 'search YouTube videos (Data API v3)',
      run: search,
    },
    {
      name: 'comments',
      usage: 'youtube comments --video <id> [--max 50]',
      about: 'top comments on a video (Data API v3)',
      run: comments,
    },
    {
      name: 'transcript',
      usage: 'youtube transcript --video <id> [--lang en]',
      about: 'plain-text captions of a video, no key needed',
      run: transcript,
    },
  ],
}

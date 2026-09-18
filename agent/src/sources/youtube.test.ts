import { afterEach, describe, expect, it, vi } from 'vitest'
import { MissingEnvError, SourceError } from '../errors.ts'
import type { Command } from './source.ts'
import { youtube } from './youtube.ts'

const search: Command['run'] = (flags, keys) => youtube.commands[0]!.run(flags, keys)
const comments: Command['run'] = (flags, keys) => youtube.commands[1]!.run(flags, keys)
const transcript: Command['run'] = (flags, keys) => youtube.commands[2]!.run(flags, keys)
const keys = { YOUTUBE_API_KEY: 'key' }
const androidAgent = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip'

const stub = (...responses: Response[]) => {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const json = (body: unknown) => new Response(JSON.stringify(body))

const track = (languageCode: string, kind?: string) => ({
  baseUrl: `https://yt.test/tt?lang=${languageCode}`,
  languageCode,
  ...(kind === undefined ? {} : { kind }),
})
const player = (tracks: unknown[]) => ({
  playabilityStatus: { status: 'OK' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
})
const xml =
  '<timedtext><body><p t="1" d="2">Hello\nthere</p><p t="3" d="4">&#39;world</p><p></p></body></timedtext>'

afterEach(() => vi.unstubAllGlobals())

describe('youtube search', () => {
  it('lists videos with decoded titles', async () => {
    const fetchMock = stub(
      json({
        items: [
          {
            id: { videoId: 'v1' },
            snippet: {
              title: 'A &amp; B',
              description: 'd',
              channelTitle: 'c',
              publishedAt: '2026-01-01T00:00:00Z',
            },
          },
        ],
      }),
    )
    await expect(search({ q: 'nvidia', max: '3' }, keys)).resolves.toEqual([
      {
        videoId: 'v1',
        url: 'https://www.youtube.com/watch?v=v1',
        title: 'A & B',
        description: 'd',
        channel: 'c',
        publishedAt: '2026-01-01T00:00:00Z',
      },
    ])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=nvidia&maxResults=3',
      { headers: { 'x-goog-api-key': 'key' } },
    )
  })
  it('defaults to ten results', async () => {
    const fetchMock = stub(json({ items: [] }))
    await search({ q: 'x' }, keys)
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=x&maxResults=10',
    )
  })
  it('names the missing key', async () => {
    await expect(search({ q: 'x' }, {})).rejects.toThrow(new MissingEnvError('YOUTUBE_API_KEY'))
  })
})

describe('youtube comments', () => {
  it('lists top level comments', async () => {
    const fetchMock = stub(
      json({
        items: [
          {
            snippet: {
              totalReplyCount: 2,
              topLevelComment: {
                snippet: {
                  authorDisplayName: 'a',
                  textOriginal: 't',
                  likeCount: 5,
                  publishedAt: '2026-01-01T00:00:00Z',
                },
              },
            },
          },
        ],
      }),
    )
    await expect(comments({ video: 'v1', max: '5' }, keys)).resolves.toEqual([
      { author: 'a', text: 't', likes: 5, replies: 2, publishedAt: '2026-01-01T00:00:00Z' },
    ])
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=v1&maxResults=5&order=relevance&textFormat=plainText',
    )
  })
})

describe('youtube transcript', () => {
  it('fetches the innertube player and the matching caption track', async () => {
    const fetchMock = stub(json(player([track('de'), track('en', 'asr')])), new Response(xml))
    await expect(transcript({ video: 'v1' }, {})).resolves.toEqual({
      videoId: 'v1',
      language: 'en',
      generated: true,
      text: "Hello there 'world",
    })
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': androidAgent },
      body: JSON.stringify({
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
        videoId: 'v1',
      }),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://yt.test/tt?lang=en', {
      headers: { 'user-agent': androidAgent },
    })
  })
  it('falls back to the first track when the language is missing', async () => {
    stub(json(player([track('fr'), track('es')])), new Response(xml))
    await expect(transcript({ video: 'v1', lang: 'de' }, {})).resolves.toMatchObject({
      language: 'fr',
      generated: false,
    })
  })
  it('fails when the video has no caption block', async () => {
    stub(json({ playabilityStatus: { status: 'OK' } }))
    await expect(transcript({ video: 'v1' }, {})).rejects.toThrow(
      new SourceError('Video v1 has no captions'),
    )
  })
  it('fails when the track list is empty', async () => {
    stub(json(player([])))
    await expect(transcript({ video: 'v1' }, {})).rejects.toThrow(SourceError)
  })
  it('reports an unplayable video with its reason', async () => {
    stub(json({ playabilityStatus: { status: 'ERROR', reason: 'Private video' } }))
    await expect(transcript({ video: 'v1' }, {})).rejects.toThrow(
      new SourceError('Video v1 is not playable: Private video'),
    )
  })
  it('reports an unplayable video without a reason', async () => {
    stub(json({ playabilityStatus: { status: 'LOGIN_REQUIRED' } }))
    await expect(transcript({ video: 'v1' }, {})).rejects.toThrow(
      new SourceError('Video v1 is not playable: LOGIN_REQUIRED'),
    )
  })
  it('fails on an empty transcript body', async () => {
    stub(json(player([track('en')])), new Response(''))
    await expect(transcript({ video: 'v1' }, {})).rejects.toThrow(
      new SourceError('Video v1 returned an empty transcript'),
    )
  })
})

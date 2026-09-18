import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpError, MissingEnvError } from '../errors.ts'
import type { Command } from './source.ts'
import { transcribe } from './transcribe.ts'

const run: Command['run'] = (flags, keys) => transcribe.commands[0]!.run(flags, keys)
const keys = { OPENAI_API_KEY: 'sk' }

afterEach(() => vi.unstubAllGlobals())

describe('transcribe', () => {
  it('downloads the audio and posts it to whisper', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])))
      .mockResolvedValueOnce(new Response('{"text":"hello"}'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(run({ url: 'https://p.test/show/ep1.mp3' }, keys)).resolves.toEqual({
      url: 'https://p.test/show/ep1.mp3',
      model: 'whisper-1',
      text: 'hello',
    })
    expect(fetchMock.mock.calls[0]![0]).toBe('https://p.test/show/ep1.mp3')
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ authorization: 'Bearer sk' })
    const form = init.body as FormData
    expect(form.get('model')).toBe('whisper-1')
    expect((form.get('file') as File).name).toBe('ep1.mp3')
  })
  it('falls back to a default filename', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('x'))
      .mockResolvedValueOnce(new Response('{"text":"t"}'))
    vi.stubGlobal('fetch', fetchMock)
    await run({ url: 'https://p.test/' }, keys)
    const form = fetchMock.mock.calls[1]![1].body as FormData
    expect((form.get('file') as File).name).toBe('audio.mp3')
  })
  it('fails loudly when the download fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 404 })))
    await expect(run({ url: 'https://p.test/a.mp3' }, keys)).rejects.toThrow(HttpError)
  })
  it('names the missing key', async () => {
    await expect(run({ url: 'https://p.test/a.mp3' }, {})).rejects.toThrow(
      new MissingEnvError('OPENAI_API_KEY'),
    )
  })
})

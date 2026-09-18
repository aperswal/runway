import { z } from 'zod'
import type { SourceKeys } from '../env.ts'
import { requireKey } from '../env.ts'
import { HttpError } from '../errors.ts'
import type { Flags } from './args.ts'
import { requireFlag } from './args.ts'
import { fetchJson } from './http.ts'
import type { Source } from './source.ts'

const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'
const MODEL = 'whisper-1'
const DEFAULT_FILENAME = 'audio.mp3'

const resultSchema = z.object({ text: z.string() })

type Transcription = { url: string; model: string; text: string }

async function download(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new HttpError(url, res.status, await res.text())
  }
  return res.blob()
}

const filenameOf = (url: string): string => {
  const { pathname } = new URL(url)
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  return last.length > 0 ? last : DEFAULT_FILENAME
}

export const transcribe: Source = {
  name: 'transcribe',
  commands: [
    {
      name: '',
      usage: 'transcribe --url <audio url>',
      about: 'download an audio file and transcribe it with OpenAI whisper-1',
      run: async (flags: Flags, keys: SourceKeys): Promise<Transcription> => {
        const key = requireKey(keys, 'OPENAI_API_KEY')
        const url = requireFlag(flags, 'url')
        const form = new FormData()
        form.append('file', await download(url), filenameOf(url))
        form.append('model', MODEL)
        const result = await fetchJson(TRANSCRIPTIONS_URL, resultSchema, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}` },
          body: form,
        })
        return { url, model: MODEL, text: result.text }
      },
    },
  ],
}

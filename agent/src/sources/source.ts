import type { SourceKeys } from '../env.ts'
import type { Flags } from './args.ts'

export type Command = {
  name: string
  usage: string
  about: string
  run: (flags: Flags, keys: SourceKeys) => Promise<unknown>
}

export type Source = { name: string; commands: Command[] }

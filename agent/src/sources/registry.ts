import { UsageError } from '../errors.ts'
import { apify } from './apify.ts'
import { edgar } from './edgar.ts'
import { hn } from './hn.ts'
import { lesswrong } from './lesswrong.ts'
import { reddit } from './reddit.ts'
import { rss } from './rss.ts'
import type { Command, Source } from './source.ts'
import { arxiv } from './arxiv.ts'
import { transcribe } from './transcribe.ts'
import { world } from './world.ts'
import { youtube } from './youtube.ts'

export const SOURCES: Source[] = [
  apify,
  youtube,
  reddit,
  hn,
  lesswrong,
  arxiv,
  rss,
  edgar,
  world,
  transcribe,
]

export const SOURCES_HELP: string = SOURCES.flatMap((source) =>
  source.commands.map((command) => `${command.usage}  ${command.about}`),
).join('\n')

export function findCommand(sourceName: string, commandName: string): Command {
  const source = SOURCES.find((candidate) => candidate.name === sourceName)
  if (source === undefined) {
    const names = SOURCES.map((candidate) => candidate.name).join(', ')
    throw new UsageError(`Unknown source "${sourceName}". Sources: ${names}`)
  }
  const command = source.commands.find((candidate) => candidate.name === commandName)
  if (command === undefined) {
    const usages = source.commands.map((candidate) => candidate.usage).join(' | ')
    throw new UsageError(`Unknown command "${commandName}" for ${sourceName}. Try: ${usages}`)
  }
  return command
}

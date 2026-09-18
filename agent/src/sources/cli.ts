import type { SourceKeys } from '../env.ts'
import { UsageError } from '../errors.ts'
import { errorMessage } from '../log.ts'
import { parseArgs } from './args.ts'
import { findCommand, SOURCES_HELP } from './registry.ts'

export type CliResult = { output: string; exitCode: number }

export async function runCli(argv: string[], keys: SourceKeys): Promise<CliResult> {
  try {
    const { source, command, flags } = parseArgs(argv)
    const result = await findCommand(source, command).run(flags, keys)
    return { output: JSON.stringify(result), exitCode: 0 }
  } catch (error) {
    const body =
      error instanceof UsageError
        ? { error: errorMessage(error), usage: SOURCES_HELP }
        : { error: errorMessage(error) }
    return { output: JSON.stringify(body), exitCode: 1 }
  }
}

import { loadSourceKeys } from './env.ts'
import { runCli } from './sources/cli.ts'

const SCRIPT_ARGS_START = 2

const { output, exitCode } = await runCli(process.argv.slice(SCRIPT_ARGS_START), loadSourceKeys())
console.log(output)
process.exitCode = exitCode

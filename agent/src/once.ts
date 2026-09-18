import { runAgent } from './run.ts'

const report = await runAgent('manual')
const INDENT = 2
process.stdout.write(`${JSON.stringify(report, null, INDENT)}\n`)
process.exit(report.error === null ? 0 : 1)

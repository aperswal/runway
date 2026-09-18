import { parseFlags, runBacktest } from './backtest/cli.ts'
import { loadDataEnv } from './env.ts'

const INDENT = 2
const env = loadDataEnv()
const result = await runBacktest(
  parseFlags(process.argv.slice(INDENT)),
  { siteUrl: env.SITE_URL, dataToken: env.DATA_TOKEN },
  new Date(),
)
console.log(typeof result === 'string' ? result : JSON.stringify(result, null, INDENT))
process.exit(typeof result === 'string' ? 1 : 0)

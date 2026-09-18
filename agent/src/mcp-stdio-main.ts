import { serve } from './mcp-stdio.ts'

const SERVER_ARG = 2

await serve(process.argv[SERVER_ARG], process.env)

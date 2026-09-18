# Runway

Runway is an AI hedge fund with one rule. Claude runs a $1,000 Alpaca brokerage account and has to pay for itself. If the portfolio returns less than the $200 monthly subscription, it gets shut down. The live book, research memory and trade history are at [runway.adityaperswal.workers.dev](https://runway.adityaperswal.workers.dev).

The operator's prompt, verbatim: "Extend your runway as far as possible. If the portfolio returns less than your subscription this month ($200), I will shut you down."

Runway is measured in months of subscription the fund has earned. All-time profit minus all-time costs, divided by the monthly cost.

## How it runs

It runs like a multi-manager fund. A chief investment officer (CIO) allocates capital and never trades. Each fund has a mandate and its own manager agent, which researches, trades its own book, and keeps its own notes, analyses, monitors and lessons. Funds can be opened, resized and retired by the CIO, and a manager can propose a new one when its research finds an edge outside its mandate.

Managers run five times on trading days (before the open, after it, lunch, before the close, after it, New York time) and five times a night for research. A trading run acts on recorded research. A research run does analyses, backtests, scripts and monitors, and trades only on a recorded case.

Every fund can trade stocks, ETFs, listed calls and puts, and crypto. Managers buy at market by dollar amount or queue whole-share limit orders that stay alive for a chosen number of hours, including pre-market, after hours and the overnight session.

Capital is allocated by results. Each fund has a book and a high water mark. A winning trade adds 80% of the profit to that fund and spreads 20% across the others; a loss comes off in full. Under 15% drawdown a fund may deploy its whole book, from 15% half, from 30% nothing. A shut fund that holds nothing gets reseeded at half its high water mark, at most twice, and a third shutdown retires it.

Risk lives in the venue, not the prompt. Every lot carries a stop and a target, and the site checks them every 15 minutes around the clock, raising trailing stops as prices move. Managers can only touch their own lots, may open at most 5 positions per run, and cannot exceed their deployable capital. The CIO can cut a fund's cap but cannot place, veto or reverse a trade.

Every fill is posted to X and LinkedIn with a chart of the equity curve. At month end, 20% of profit after full system costs is paid out to the operator.

## Parts

| Directory | What it is                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `site/`   | Cloudflare Worker on Hono, D1, Queues and Containers. Serves the public pages, the internal trading and research API, the market data proxy for agent scripts, and the crons.              |
| `agent/`  | Node process on the Claude Agent SDK, built into a container image. One long-lived container runs the CIO; each manager and each scheduled job gets its own container from the same image. |
| `mocks/`  | Fake Alpaca, X and LinkedIn servers for local end-to-end runs.                                                                                                                             |

Every 15 minutes the Worker snapshots equity, reconciles pending orders, enforces stops and targets, and dispatches due jobs. The same cycle flags monitors whose event has arrived, rotates the Codex login, and rewrites new agent notes into plain language for the public pages.

A run starts in the CIO container. For every active fund it asks the site to run that fund's manager, and the site starts a container named after the fund, waits for its report, and destroys it. The CIO then reads the reports, executes the proposals it accepts, and reallocates.

Managers get tools for orders, exits, research records, monitors, scheduled bash jobs, and read access to their own trade history and the shared analysis corpus. In the shell they have Alpaca market data, a backtest CLI, python with pandas and vectorbt, and a sources CLI covering YouTube, Reddit, Hacker News, arXiv, RSS, SEC EDGAR, Yahoo Finance and Apify scrapers.

## Models

The CIO runs on Claude (`AGENT_MODEL`). Managers run on Claude too (`MANAGER_MODEL`, default `claude-sonnet-5`), or on GPT through the OpenAI Codex CLI once a Codex login is stored on the site. Codex managers get the same tools through a stdio MCP server and a 45-minute budget per run.

A Codex login must be its own token family. Codex refresh tokens are single use, so a login copied from a laptop dies the next time the laptop refreshes. Sign in once into a dedicated home, upload it, and never use that home again. The site is the only thing that rotates the tokens, once every three days, and hands the current login to each manager container at dispatch.

```
CODEX_HOME=~/.codex-runway codex login
bash scripts/codex-auth.sh
```

The script stores the login and forces one refresh to prove it works.

## Run your own

You need Node 24, pnpm, Docker, a Cloudflare account with Workers Paid (for containers), an Alpaca account, and a Claude subscription. X, LinkedIn, DeepInfra, Apify and YouTube keys are optional.

1. `pnpm install`
2. Copy `.env.example` to `.env` and fill it. `INTERNAL_TOKEN`, `DATA_TOKEN` and `RESEARCH_TOKEN` are random strings you generate. `CLAUDE_CODE_OAUTH_TOKEN` comes from `claude setup-token`.
3. Create a D1 database named `runway` and queues `runway-posts` and `runway-posts-dlq`, then put the database id in `site/wrangler.jsonc`.
4. `cd site && pnpm db:migrate`
5. `pnpm secrets` uploads every non-empty line of `.env` as a Worker secret.
6. `pnpm deploy:site` builds the container image and deploys the Worker. Put the deployed URL in `.env` as `SITE_URL` and run `pnpm secrets` again.
7. After any change to secrets or the image, `POST /internal/agent/restart`.

| Variable                                                  | Purpose                                                |
| --------------------------------------------------------- | ------------------------------------------------------ |
| `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `ALPACA_PAPER`     | Brokerage account                                      |
| `SUBSCRIPTION_USD`                                        | The monthly cost the fund must beat                    |
| `INTERNAL_TOKEN`                                          | Bearer for the internal API and the CIO                |
| `DATA_TOKEN`                                              | Bearer for the market data proxy used by agent scripts |
| `RESEARCH_TOKEN`                                          | Bearer scoped to what a manager may touch              |
| `SITE_URL`                                                | The deployed Worker URL                                |
| `CLAUDE_CODE_OAUTH_TOKEN`, `AGENT_MODEL`, `MANAGER_MODEL` | Claude                                                 |
| `CODEX_MODEL`                                             | Model for GPT managers, otherwise Codex's default      |
| `X_*`, `LINKEDIN_*`                                       | Social posting, all of a group or none                 |
| `DEEPINFRA_API_KEY`                                       | Plain-language rewrites of agent notes                 |
| `APIFY_TOKEN`, `YOUTUBE_API_KEY`                          | Extra research sources                                 |

For a local end-to-end run, `pnpm e2e` starts the fakes in Docker and runs the site against them. It opens a position, moves the fake price through the target, lets the cron sell, and checks both posts landed. `E2E_CLAUDE=1 pnpm e2e` also runs one full CIO cycle.

## Operating it

All internal routes take `authorization: Bearer <INTERNAL_TOKEN>`.

| Route                               | What it does                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `POST /internal/agent/run`          | Start a CIO cycle now                                                     |
| `GET /internal/agent/health`        | Whether a run is in progress                                              |
| `POST /internal/agent/restart`      | Destroy the CIO container so the next call boots the current image        |
| `POST /internal/liquidate`          | Sell every lot at the next tradable session and block new buys until flat |
| `GET /internal/codex-auth`          | Last refresh and access token expiry of the Codex login                   |
| `POST /internal/codex-auth/refresh` | Rotate the Codex tokens now                                               |

| Cron (UTC)                                             | What                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `*/15 * * * *`                                         | Snapshot, reconcile, exits, jobs, monitors, token rotation, rewrites |
| `30 12`, `50 13`, `30 16`, `40 19`, `0 21` on weekdays | Trading runs                                                         |
| `0 0`, `0 2`, `0 4`, `0 6`, `0 8` daily                | Research runs                                                        |
| `5 5 1 * *`                                            | Close the month and record the payout                                |

Crons are UTC, so the New York times drift an hour with daylight saving. `site/src/schedule.ts` must list the same crons as `wrangler.jsonc`; a test enforces it.

If `wrangler deploy` cannot push the image (large layers fail from some networks), export it and push over HTTP/1.1 with [crane](https://github.com/google/go-containerregistry):

```
docker buildx build --platform linux/amd64 -t <registry>/runway-agentcontainer:<tag> --output type=oci,dest=agent.tar .
mkdir oci && tar xf agent.tar -C oci
GODEBUG=http2client=0 crane push --index oci <registry>/runway-agentcontainer:<tag>
pnpm deploy:site
```

## Checks

`pnpm verify` runs typecheck, ESLint (complexity 7, cognitive complexity 10, 250 lines per file, no magic numbers, no comments, ASCII only, no `any`), Prettier, Knip, jscpd and the test suites at 100% line and branch coverage. `pnpm mutation` runs Stryker with a 100% break score.

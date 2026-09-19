#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: bash scripts/reset-ledger.sh <start-date YYYY-MM-DD> <start-equity>" >&2
  exit 1
fi

day="$1"
equity="$2"
anchor="${day}T04:00:00.000Z"

cd "$(dirname "$0")/../site"
mkdir -p ../backups
for table in trades snapshots posts runs manager_runs distributions funds; do
  pnpm exec wrangler d1 export runway --remote --table "$table" \
    --output "../backups/$(date -u +%Y-%m-%dT%H%M)-$table.sql" >/dev/null
done

pnpm exec wrangler d1 execute runway --remote --yes --command "
delete from posts;
delete from trades;
delete from runs;
delete from manager_runs;
delete from distributions;
delete from snapshots;
update funds set capital = round(share * $equity, 2), high_water = round(share * $equity, 2), rescues = 0, rescued_at = null where status = 'active';
update funds set capital = 0, high_water = 0 where status <> 'active';
insert into snapshots (taken_at, equity, cash, positions) values ('$anchor', $equity, $equity, '[]');
"

pnpm exec wrangler d1 execute runway --remote --command \
  "select (select min(taken_at) from snapshots) as ledger_starts, (select count(*) from trades) as trades, (select round(sum(capital), 2) from funds where status = 'active') as active_books"

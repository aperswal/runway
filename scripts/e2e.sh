#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

MOCKS=http://localhost:9999
SITE=http://localhost:8787
set -a; source .env; set +a

log() { printf '\n== %s\n' "$*"; }
fail() { printf 'e2e: %s\n' "$*" >&2; exit 1; }
wait_for() { for _ in $(seq 1 60); do curl -sf "$1" >/dev/null && return 0; sleep 1; done; fail "timeout waiting for $1"; }
site() { curl -sf -H "Authorization: Bearer $INTERNAL_TOKEN" -H 'content-type: application/json' "$@"; }

log "mocks in docker"
docker compose up -d --build mocks
wait_for "$MOCKS/_control/state"
curl -sf -X POST "$MOCKS/_control/reset" >/dev/null

log "site (wrangler dev against the mocks)"
pkill -f "wrangler dev --test-scheduled" 2>/dev/null || true
rm -rf site/.wrangler/state
(cd site && pnpm db:migrate:local >/dev/null)
(cd site && pnpm exec wrangler dev --test-scheduled --port 8787 \
  --var ALPACA_TRADING_URL:"$MOCKS/alpaca" --var ALPACA_DATA_URL:"$MOCKS/alpaca-data" \
  --var X_API_URL:"$MOCKS/x" --var LINKEDIN_API_URL:"$MOCKS/linkedin" \
  --var DEEPINFRA_API_URL:"$MOCKS/deepinfra" --var DEEPINFRA_API_KEY:di \
  --var X_API_KEY:k --var X_API_SECRET:s --var X_ACCESS_TOKEN:t --var X_ACCESS_SECRET:ts \
  --var LINKEDIN_ACCESS_TOKEN:lt --var LINKEDIN_PERSON_URN:urn:li:person:e2e \
  --var SITE_URL:"$SITE" > ../.wrangler-e2e.log 2>&1) &
WRANGLER_PID=$!
trap 'pkill -f "wrangler dev --test-scheduled" 2>/dev/null || true; kill $WRANGLER_PID 2>/dev/null || true' EXIT
wait_for "$SITE/api/summary"

log "snapshot cron"
curl -sf "$SITE/__scheduled?cron=*/15+*+*+*+*" >/dev/null; sleep 2
EQUITY=$(curl -sf -H "cache-control: no-cache" "$SITE/api/summary" | python3 -c 'import sys,json; print(json.load(sys.stdin)["equity"])')
echo "equity after snapshot: $EQUITY"
[[ "$EQUITY" != "0" ]] || fail "snapshot did not record equity"

log "open a position through the internal API (what the agent's tool calls)"
curl -sf -X POST "$MOCKS/_control/price" -H 'content-type: application/json' -d '{"symbol":"BTC/USD","price":100}' >/dev/null
site -X POST "$SITE/internal/positions" -d '{"fund":"social","symbol":"BTC/USD","notional":50,"stop":90,"target":110,"horizon":"2 weeks","reason":"e2e buy"}' | python3 -c 'import sys,json; t=json.load(sys.stdin); print("trade", t["id"], t["status"], t["entryPrice"])'

log "price hits target, cron sells"
curl -sf -X POST "$MOCKS/_control/price" -H 'content-type: application/json' -d '{"symbol":"BTC/USD","price":111}' >/dev/null
curl -sf "$SITE/__scheduled?cron=*/15+*+*+*+*" >/dev/null
sleep 4

log "posts received by the fake X and LinkedIn"
curl -sf "$MOCKS/_control/posts" > .e2e-posts.json
python3 - <<'PY'
import json
posts = json.load(open(".e2e-posts.json"))
for p in posts:
    print(f"[{p['network']}] {p['text']} (image {p['image']} bytes)")
    assert p["image"] and p["image"] > 0, f"post without a chart image: {p}"
texts = [p["text"] for p in posts]
assert any(t.startswith("Buying $BTC because e2e buy.") for t in texts), "buy post missing"
assert any(t.startswith("Sold $BTC at") and "Hit target." in t for t in texts), "sell post missing"
by = {n: len([p for p in posts if p["network"] == n]) for n in ("x", "linkedin")}
assert by == {"x": 2, "linkedin": 2}, f"expected 2 posts per network, got {by}"
print("posts ok")
PY

log "a note is rewritten in plain words by the fake DeepInfra"
site -X POST "$SITE/internal/notes" -d '{"fund":"social","title":"e2e note","body":"RSI oversold, mkt closed"}' >/dev/null
curl -sf "$SITE/__scheduled?cron=*/15+*+*+*+*" >/dev/null; sleep 2
curl -sf -H "cache-control: no-cache" "$SITE/notes" | grep -q "Plain: RSI oversold, mkt closed" || fail "plain rewrite missing on the notes page"
curl -sf -H "cache-control: no-cache" "$SITE/notes?view=agent" | grep -q "RSI oversold, mkt closed" || fail "agent wording missing"

log "public page renders the closed trade"
curl -sf "$SITE/" | grep -q 'Hit target\|target' || fail "closed trade not on page"
curl -sf -H "cache-control: no-cache" "$SITE/api/summary" | python3 -c 'import sys,json; s=json.load(sys.stdin); assert s["closedTrades"][0]["exitReason"]=="target"; print("summary ok, realized", s["metrics"]["realizedPl"])'

if [[ "${E2E_CLAUDE:-0}" == "1" ]]; then
  log "full agent run through Claude (uses your Max subscription)"
  SITE_URL="$SITE" pnpm agent:once
  curl -sf -H "cache-control: no-cache" "$SITE/api/summary" | python3 -c 'import sys,json; s=json.load(sys.stdin); print("last run:", s["lastRun"])'
fi

log "e2e passed"

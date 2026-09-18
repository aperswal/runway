#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
home="${CODEX_RUNWAY_HOME:-$HOME/.codex-runway}"
site="$(grep '^SITE_URL=' .env | cut -d= -f2-)"
token="$(grep '^INTERNAL_TOKEN=' .env | cut -d= -f2-)"

if [ ! -f "$home/auth.json" ]; then
  echo "no $home/auth.json; run: CODEX_HOME=$home codex login" >&2
  exit 1
fi

curl -fsS -X POST "$site/internal/codex-auth" \
  -H "authorization: Bearer $token" \
  -H "content-type: application/json" \
  --data-binary "@$home/auth.json"
echo
curl -fsS -X POST "$site/internal/codex-auth/refresh" -H "authorization: Bearer $token"
echo

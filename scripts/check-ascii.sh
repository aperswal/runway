#!/usr/bin/env bash
set -euo pipefail

IN_SCOPE_REGEX='\.(ts|js|mjs|cjs|md|json|jsonc|ya?ml|sh|sql|toml|html|css)$|(^|/)Dockerfile$'
EXCLUDE_REGEX='(^|/)(node_modules|dist|coverage|reports|\.git|\.wrangler|\.stryker-tmp|migrations)(/|$)|(^|/)pnpm-lock\.yaml$'

collect_files() {
  if [[ $# -gt 0 ]]; then printf '%s\n' "$@"
  elif git rev-parse --git-dir >/dev/null 2>&1; then git ls-files
  else find . -type f ! -path '*/node_modules/*' ! -path '*/.git/*'
  fi
}

violations=0
while IFS= read -r file; do
  [[ -z "$file" || ! -f "$file" ]] && continue
  if [[ ! "$file" =~ $IN_SCOPE_REGEX ]] || [[ "$file" =~ $EXCLUDE_REGEX ]]; then continue; fi
  if matches=$(perl -ne 'print "$.: $_" if /[^\x00-\x7F]/' "$file") && [[ -n "$matches" ]]; then
    echo "$file:"; echo "$matches" | sed 's/^/  /'; echo
    violations=$((violations + 1))
  fi
done < <(collect_files "$@")

if [[ $violations -gt 0 ]]; then
  echo "check-ascii: $violations file(s) contain non-ASCII characters" >&2
  exit 1
fi
echo "check-ascii: all files are pure ASCII"

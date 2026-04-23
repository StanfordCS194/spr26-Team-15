#!/usr/bin/env bash
# Pre-commit hook: block commits containing real-looking API keys.
# Run manually: ./scripts/check-secrets.sh
set -euo pipefail

PATTERNS=(
  'sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,}'
  'sk-proj-[A-Za-z0-9_-]{20,}'
  'AKIA[0-9A-Z]{16}'
  'ghp_[A-Za-z0-9]{30,}'
)

# Files staged for commit (diff-filter=d excludes deletions). Fall back to tracked files if not in a git hook context.
if git diff --cached --name-only --diff-filter=d >/dev/null 2>&1; then
  FILES=$(git diff --cached --name-only --diff-filter=d)
else
  FILES=$(git ls-files)
fi

if [[ -z "${FILES:-}" ]]; then
  exit 0
fi

EXIT=0
for pattern in "${PATTERNS[@]}"; do
  # xargs -r not portable to macOS; guard with check above.
  if echo "$FILES" | xargs grep -I -E -n "$pattern" 2>/dev/null; then
    echo "ERROR: potential secret matching /$pattern/ detected in staged files." >&2
    EXIT=1
  fi
done

if [[ $EXIT -ne 0 ]]; then
  echo "Commit blocked. Rotate the key if it already touched disk, then remove it from staging." >&2
  exit 1
fi
exit 0

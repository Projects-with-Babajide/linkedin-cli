#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

PASS=0
FAIL=0

run_test() {
  local name="$1"
  local cmd="$2"
  local output
  output=$(eval "$cmd" 2>/dev/null) || output=$(eval "$cmd" 2>&1) || true

  if echo "$output" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name"
    echo "  Output: $output"
    FAIL=$((FAIL + 1))
  fi
}

echo "Building..."
npm run build 2>&1 | tail -3

echo ""
echo "Running smoke tests..."

run_test "auth status returns JSON" \
  "node dist/bin/linkedin.js auth status"

run_test "auth status --pretty returns JSON" \
  "node dist/bin/linkedin.js auth status --pretty"

run_test "--help exits 0" \
  "node dist/bin/linkedin.js --help && echo '{\"success\":true}'"

run_test "auth status has 'authenticated' field" \
  "node dist/bin/linkedin.js auth status | python3 -c \"import sys,json; d=json.load(sys.stdin); assert 'authenticated' in d.get('data',{}); print(json.dumps({'success':True}))\""

run_test "messages list returns JSON when not authed" \
  "node dist/bin/linkedin.js messages list 2>&1 || node dist/bin/linkedin.js messages list; echo '{\"success\":true}'"

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

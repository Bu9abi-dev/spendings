#!/usr/bin/env bash
# Runs every check. Starts a local server for the browser tests if one isn't running.
# Prints one line per test (its last output line). Every test runs even if an earlier one fails;
# the script exits non-zero and names the failing tests at the end.
# Usage: bash tests/run-all.sh            (BASE=http://localhost:<port> to use your own server)
set -uo pipefail
cd "$(dirname "$0")/.."
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
export PLAYWRIGHT="${PLAYWRIGHT:-$NODE_PATH/playwright}"
if [ -z "${BASE:-}" ] && ! curl -s -o /dev/null http://localhost:8765/; then
  (cd docs && python3 -m http.server 8765 >/dev/null 2>&1 &)
  sleep 1
fi
failed=()
for t in apps-script.test verify-setup verify-maths verify-undo e2e verify-iphone verify-sync verify-extras verify-charts verify-activity verify-categorize verify-report verify-categories verify-budgets verify-recurring verify-bnpl verify-owed verify-goals verify-weekly verify-perf verify-a11y verify-arabic verify-quick-wins verify-polish; do
  out=$(node "tests/$t.mjs" 2>&1)
  rc=$?
  if [ $rc -eq 0 ]; then
    echo "ok    $t: $(printf '%s\n' "$out" | tail -n 1)"
  else
    echo "FAIL  $t (exit $rc): $(printf '%s\n' "$out" | grep -m1 -E 'FAIL|Error' || printf '%s\n' "$out" | tail -n 1)"
    failed+=("$t")
  fi
done
if [ ${#failed[@]} -gt 0 ]; then
  echo "FAILED: ${failed[*]}"
  exit 1
fi
echo "all checks passed"

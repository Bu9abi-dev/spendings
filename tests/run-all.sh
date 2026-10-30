#!/usr/bin/env bash
# Runs every check. Starts a local server for the browser tests if one isn't running.
# Usage: bash tests/run-all.sh
set -eo pipefail
cd "$(dirname "$0")/.."
export NODE_PATH="${NODE_PATH:-$(npm root -g)}"
export PLAYWRIGHT="${PLAYWRIGHT:-$NODE_PATH/playwright}"
if [ -z "$BASE" ] && ! curl -s -o /dev/null http://localhost:8765/; then
  (cd docs && python3 -m http.server 8765 >/dev/null 2>&1 &)
  sleep 1
fi
for t in apps-script.test verify-setup verify-maths verify-undo e2e verify-iphone verify-sync verify-extras verify-charts verify-activity verify-categorize verify-report verify-categories verify-budgets verify-recurring verify-bnpl verify-owed verify-goals verify-weekly verify-perf verify-a11y verify-arabic verify-quick-wins; do
  echo "── $t"
  node "tests/$t.mjs" 2>&1 | tail -n 1
done
echo "all checks passed"

#!/usr/bin/env bash
# rebuild.sh — regenerate all pipeline outputs and run tests.
#
# Does NOT run scrape_valuables.py — that hits the network and is run
# separately when the valuables list needs updating.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Calculating drop odds..."
python3 "$SCRIPTS_DIR/calculate_drop_odds.py"

echo "==> Building db.json..."
python3 "$SCRIPTS_DIR/build_db.py"

echo "==> Running tests..."
python3 -m pytest "$SCRIPTS_DIR/tests/" -q

echo "==> Done."

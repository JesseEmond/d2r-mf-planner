#!/usr/bin/env bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/pinkufairy/D2R-Excel/main"
OUT_DIR="$(dirname "$0")/../data/raw"

mkdir -p "$OUT_DIR"

for file in treasureclassex.txt itemratio.txt weapons.txt armor.txt monstats.txt misc.txt superuniques.txt uniqueitems.txt setitems.txt itemtypes.txt; do
    echo "Fetching $file..."
    curl -fsSL "$REPO_RAW/$file" -o "$OUT_DIR/$file"
done

echo "Done."

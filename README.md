# D2R Blizzard Sorceress ETTVD Optimizer

A static web app that calculates **Expected Time to Valuable Drop (ETTVD)** for a Blizzard Sorceress in Diablo II: Resurrected, and ranks gear upgrades by efficiency (Δ ETTVD / rune cost).

## Prerequisites

- Python 3.11+
- D2R data files in `data/raw/` (copy from your D2R installation):
  - `TreasureClassEx.txt`
  - `ItemRatio.txt`
  - `Weapons.txt`
  - `Armor.txt`
  - `monstats.txt`

## Running the Pipeline

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

python scripts/scrape_valuables.py       # → public/data/valuables.json
python scripts/parse_treasure_classes.py # (library, no output)
python scripts/calculate_drop_odds.py    # → public/data/drop_odds.json
python scripts/scrape_rune_economy.py    # → public/data/rune_economy.json
python scripts/build_db.py              # → public/data/db.json
```

Or run everything at once:

```bash
python scripts/build_db.py
```

## Output

`public/data/db.json` is consumed by the static frontend (no build step required). Open `index.html` directly in a browser or serve via any static host (GitHub Pages).

## Running Tests

```bash
python -m pytest scripts/tests/
```

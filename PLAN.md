# Milestone 1 Commit Plan: The Offline D2 Math Engine (Python Pipeline)

See `prd.md` §3 Milestone 1 for the full requirements. Each commit maps to one or more PRD tasks.

---

## Commit 1: `scaffold: project structure and raw data files`
- Create `scripts/`, `public/data/`, `data/raw/` directories
- Add D2R `.txt` source files (`TreasureClassEx.txt`, `ItemRatio.txt`, `Weapons.txt`, `Armor.txt`, `monstats.txt`) under `data/raw/`
- Add `.gitignore` (ignore `__pycache__`, `.venv`, etc.)
- Add `README.md` explaining how to run the pipeline

## Commit 2: `feat(scripts): scrape_valuables.py — Maxroll trade-value item list` (Task 1.1)
- `scripts/scrape_valuables.py` — fetches/parses the Maxroll.gg valuables page, outputs a JSON array of item base names (e.g., `["Shako", "Oculus", ...]`)
- Writes to `public/data/valuables.json` (intermediate artifact consumed by the next script)

## Commit 3: `feat(scripts): parse_treasure_classes.py — D2R txt ingestion` (Task 1.2)
- `scripts/parse_treasure_classes.py` — parses all five `.txt` files into Python dicts/dataclasses
- Exposes helpers: `get_tc_chain(monster, difficulty)`, `get_item_ratio(base_item)`, `get_item_meta(base_item)`
- No file output yet; this is a library module imported by subsequent steps

## Commit 4: `feat(scripts): calculate_drop_odds.py — base item & rune probabilities` (Task 1.3)
- `scripts/calculate_drop_odds.py` — walks the TC chain for each of the 6 target bosses/areas (Hell Andy, Meph, Cows, Travincal, Pindle, Ancient Tunnels)
- Computes: base drop probability per valuable base item, GC/SC base probability, High Rune (Pul+) probability
- Extracts and stores ItemRatio quality divisors (Qlvl, unique_divisor, set_divisor) needed for client-side MF math
- Outputs intermediate `public/data/drop_odds.json`

## Commit 5: `feat(scripts): scrape_rune_economy.py — rune value index from Diablo.io` (Task 1.4)
- `scripts/scrape_rune_economy.py` — fetches Diablo.io rune ladder page, parses equivalencies into a Pul-normalized cost map (e.g., `{"Ist": 6, "Ber": 36, ...}`)

## Commit 6: `feat(scripts): build_db.py — assemble and emit public/data/db.json` (Task 1.4 completion)
- `scripts/build_db.py` — top-level entry point that calls all prior modules and merges outputs into `public/data/db.json`
- `db.json` schema: `{ "valuables": [...], "monsters": { "andy": { "drop_odds": {...} }, ... }, "item_ratios": {...}, "rune_economy": {...} }`
- Commit includes a sample/frozen `public/data/db.json` so the UI works without re-running the pipeline

## Commit 7: `test: validate drop odds against known community benchmarks`
- `scripts/tests/test_drop_odds.py` — spot-checks known values (e.g., Andy's Shako drop rate matches community-accepted ~1:250 with 0 MF)
- Ensures the pipeline is correct before Milestone 2 depends on it

---

## Sequencing Notes
- Commits 2–5 can be developed in parallel but should land in the order above
- Commit 3 (the TC parser) is the **critical path** — commits 4 and 5 both import it
- `build_db.py` (commit 6) depends on all prior scripts being complete

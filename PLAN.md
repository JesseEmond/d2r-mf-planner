# Milestone 1 Commit Plan: The Offline D2 Math Engine (Python Pipeline)

See `prd.md` §3 Milestone 1 for the full requirements. Each commit maps to one or more PRD tasks.

---

## Commit 2: `feat(scripts): calculate_drop_odds.py — base item & rune probabilities` (Task 1.3)
- `scripts/calculate_drop_odds.py` — walks the TC chain for each of the 6 target bosses/areas (Hell Andy, Meph, Cows, Travincal, Pindle, Ancient Tunnels)
- For each valuable item, stores **three separate probability components** (all needed because MF affects only step 2 and step 3b is MF-independent):
  1. `base_prob`: P(this base item type is selected from the TC tree) — MF-independent, computed by `walk_tc`
  2. `quality_params`: `{base_chance, divisor, min_chance, quality_factor, qlvl}` from ItemRatio + the propagated QualityFactor — these are the inputs to the client-side MF formula; the client computes `P(unique quality | MF)` at render time
  3. `unique_weight` and `unique_total_weight`: rarity of this specific unique vs. sum of all eligible unique rarities for this base type at this ilvl — MF-independent; `P(specific unique) = unique_weight / unique_total_weight`
- Full drop probability formula (for reference, not pre-computed): `base_prob × P(unique quality | MF) × unique_weight/unique_total_weight`
- Also computes: GC/SC base probability, High Rune (Pul+) probability (runes/charms are not affected by MF — selected directly by type from "Good" TCs with no quality roll)
- Outputs intermediate `public/data/drop_odds.json`

## Commit 3: `feat(scripts): scrape_rune_economy.py — rune value index from Diablo.io` (Task 1.4)
- `scripts/scrape_rune_economy.py` — fetches Diablo.io rune ladder page, parses equivalencies into a Pul-normalized cost map (e.g., `{"Ist": 6, "Ber": 36, ...}`)

## Commit 4: `feat(scripts): build_db.py — assemble and emit public/data/db.json` (Task 1.4 completion)
- `scripts/build_db.py` — top-level entry point that calls all prior modules and merges outputs into `public/data/db.json`
- `db.json` schema: `{ "valuables": [...], "monsters": { "andy": { "drop_odds": {...} }, ... }, "item_ratios": {...}, "rune_economy": {...} }`
- Commit includes a sample/frozen `public/data/db.json` so the UI works without re-running the pipeline

## Commit 5: `test: validate drop odds against known community benchmarks`
- `scripts/tests/test_drop_odds.py` — spot-checks known values (e.g., Andy's Shako drop rate matches community-accepted ~1:250 with 0 MF)
- Ensures the pipeline is correct before Milestone 2 depends on it

---

## Sequencing Notes
- Commit 1 (the TC parser) is the **critical path** — commits 2 and 3 both import it
- `build_db.py` (commit 4) depends on all prior scripts being complete

## Tracking Progress
Each commit that completes a task should also remove that commit's section from this file, so `PLAN.md` always reflects only the remaining work. When all commits are done, delete this file.

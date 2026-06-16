# Milestone 1 Commit Plan: The Offline D2 Math Engine (Python Pipeline)

See `prd.md` §3 Milestone 1 for the full requirements. Each commit maps to one or more PRD tasks.

---

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

# Milestone 1 Commit Plan: The Offline D2 Math Engine (Python Pipeline)

See `prd.md` §3 Milestone 1 for the full requirements. Each commit maps to one or more PRD tasks.

---

## Commit 3: `feat(scripts): build_db.py — assemble and emit public/data/db.json` (Task 1.4 completion)
- `scripts/build_db.py` — reads `data/valuables.json` and `data/drop_odds.json`, merges into `public/data/db.json`
- `db.json` schema: `{ "valuables": [...], "monsters": { "andy": { "mlvl": ..., "tc": ..., "drops": {...}, "rune_prob": ..., "gc_base_prob": ..., "sc_base_prob": ... } } }`
- Commit includes a frozen `public/data/db.json` so the UI works without re-running the pipeline
- Note: `rune_economy` deferred to Milestone 5 (upgrade ranker); it's only needed for cost-efficiency scoring

## Commit 4: `test: validate drop odds against known community benchmarks`
- `scripts/tests/test_drop_odds.py` — spot-checks known values (e.g., Andy's Shako drop rate matches community-accepted ~1:250 with 0 MF)
- Ensures the pipeline is correct before Milestone 2 depends on it

---

## Sequencing Notes
- Commit 1 (the TC parser) is the **critical path** — commit 2 imports it
- `build_db.py` (commit 3) depends on all prior scripts being complete

## Tracking Progress
Each commit that completes a task should also remove that commit's section from this file, so `PLAN.md` always reflects only the remaining work. When all commits are done, delete this file.

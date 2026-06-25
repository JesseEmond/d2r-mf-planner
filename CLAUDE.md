# Project Guidelines

## Data Extraction Philosophy

The Python build scripts (`scripts/`) turn raw D2R data files (`data/raw/`) into the
processed outputs (`data/db.json`, `data/run_config.json`, etc.) consumed by the frontend.

**Default assumption: the information is in the data files.**

D2R is a data-driven game. Almost every mechanic is defined in the txt files under
`data/raw/`. When a value cannot be found, the first response should be to question
whether we are reading the right file, reading it correctly, or are missing a file
entirely — not to hardcode the value.

### Ordering of approaches

1. **Extract from txt files.** Parse the relevant column(s) and derive the value
   programmatically. This is the default and preferred path for all constants,
   formulas, and relationships.

2. **Fetch a missing file.** If a needed file is not yet in `data/raw/`, add it to
   `scripts/fetch_raw_data.sh` and fetch it. The source repo is documented in
   `data/raw/` and in memory. Most Blizzard txt tables are available there.

3. **Hardcode with full documentation.** Only as a last resort, when the value is
   genuinely an engine constant that Blizzard did not expose in any data file (confirmed
   after a real search, not assumed). Every hardcoded constant must have:
   - A comment naming the value and what it represents
   - An explanation of why it cannot be extracted from data
   - A reference (URL, file, community resource) that documents it
   - A note that it should be revisited if a data source is found later

## Generated files are read-only

Never edit generated files directly. Always fix the script that produces them and rerun it.

| File | Produced by |
|---|---|
| `data/valuables.json` | `scripts/scrape_valuables.py` |
| `data/drop_odds.json` | `scripts/calculate_drop_odds.py` |
| `public/data/db.json` | `scripts/build_db.py` (orchestrates all of the above) |

After any pipeline change, run `scripts/rebuild.sh` — it regenerates `drop_odds.json`,
rebuilds `db.json`, and runs all tests in one step. Do not run the scripts individually.

If a value is wrong in a generated file, trace it back to the script or the raw data file
and fix it there. Editing the output directly breaks reproducibility — the next pipeline run
will overwrite the change.

The one exception is `scrape_valuables.py`: its `MANUAL_ADDITIONS` list is intentional
human curation (items the scraper misses or that we deliberately include/exclude). Changes
there are fine; changes to `data/valuables.json` directly are not.

## Script vs. d2r_data.py

`d2r_data.py` owns all raw D2R file I/O. Any function that reads a `.txt` or `.json` file
from `data/raw/` belongs there. Downstream scripts (`calculate_drop_odds.py`,
`extract_combat_stats.py`, `extract_gear_stats.py`, etc.) only call `d2r_data` functions —
they never open raw files themselves.

The test: if a function's only job is "read this D2R file and return structured data," it
lives in `d2r_data.py`. If it applies project-level logic or formulas to that data, it lives
in the script.

### What this means in practice

- If you can't find a value in the expected file, look for related files before giving up.
  Cross-reference `monumod.txt`, `monstats.txt`, `monprop.txt`, `superuniques.txt`,
  `levels.txt`, `lvlprest.txt`, `monlvl.txt`, etc. — they form a linked system.
- Formulas involving monster stats (HP, resistances, drop rates) are derivable.
  Check `docs/combat_mechanics.md` for worked examples with sources.
- Super-unique zone assignments are a known exception: they live in binary DS1 map files
  and cannot be read from txt. These are hardcoded with that explanation.
- Engine constants confirmed as not data-driven (e.g. +75 cold resist from Cold Enchanted,
  +40 from Magic Resistant, number of random mods per difficulty) are hardcoded with
  references to maxroll.gg/d2/resources/elite-monster and documented in
  `docs/combat_mechanics.md`.

## docs/ — living reference documentation

The `docs/` directory contains human-readable reference documents that capture
discovered mechanics, formulas, and data-source decisions. These are **not** generated
files — they are maintained by hand and serve as the authoritative record of what we
know and how we know it.

**Update `docs/` whenever you:**
- Discover or verify a formula (HP, resistances, drop probabilities, elite mod effects, etc.)
- Identify a new data source or cross-file relationship
- Confirm or correct a value against a community resource
- Add a hardcoded constant (document it in the relevant `docs/` file as well as in code)
- Find that a previous `docs/` entry was wrong and correct it

Current docs files:

| File | Contents |
|---|---|
| `docs/combat_mechanics.md` | Elite mod counts, cold immunity math, HP formula, Trav council stats |
| `docs/gear_data.md` | Sunder Charm random bonus stat ranges (propertygroups.txt derivation) |

If the relevant information doesn't fit an existing file, create a new one and list it here.

## Changelog

`public/js/changelog.js` contains `UNRELEASED` (pending changes) and `RELEASES` (dated history).

**Before making any commit, check whether the change warrants an UNRELEASED entry** —
this is the natural touchpoint to catch it, since it's easy to forget once the commit lands.

### When to add an UNRELEASED entry

Add an entry whenever you make a change **a user of the site would notice and care about**:

- New runs, bosses, or items added
- New stats, calculations, or formulas that affect results
- New UI sections or features
- Bug fixes that visibly affected numbers or behavior
- Meaningful QoL (e.g. state persistence, alphabetical sorting)

**Skip** (do not add entries for):
- Tooltip additions or wording tweaks
- Visual polish, layout moves, CSS changes
- Internal refactors with no visible effect
- Pipeline-only changes (scripts, data extraction)
- Display-only fixes (e.g. changing "0.0s" to "skipped")

### How to write entries

Write from the player's perspective in plain language — not commit-message style.

- Good: `'Trav run: full council kill time and drop odds now modeled'`
- Bad: `'feat(config): add Trav to run_config with group combat stats'`

A sentence like "can now see X in the Y tooltip" is fine if X is genuinely useful info to a player. Keep entries concise — one clause is usually enough.

### Releasing

Run `/release` before deploying. It surfaces UNRELEASED entries and recent commits, then curates them into a dated release entry (rephrasing and filtering as needed). `gh-deploy.sh` will refuse to run if `UNRELEASED` is non-empty.

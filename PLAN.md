# Gear Stats Extraction Pipeline

Replace hand-coded `gear-db.js` preset items with stats auto-extracted from D2R raw data files,
served through `db.json`. Implemented in four incremental phases.

---

## Config file: `data/items_config.json`

Minimal source of truth. Uses D2R internal item names (= first column of `uniqueitems.txt` /
`setitems.txt`) directly as IDs — no short aliases. `presets` are named complete gear builds
(slot → item), replacing the hardcoded `TARGET_GEAR_PRESETS` in `app.js`. The `custom`
placeholder item is NOT listed here — JS appends it client-side to each slot's dropdown.

```json
{
  "unique_items": [
    "Harlequin Crest",
    "Griffon's Eye",
    "Mara's Kaleidoscope",
    "The Eye of Etlich",
    "The Oculus",
    "Wizardspike",
    "Eschuta's temper",
    "Lidless Wall",
    "Skin of the Vipermagi",
    "Magefist",
    "Arachnid Mesh",
    "Goldwrap",
    "Wartraveler",
    "Silkweave",
    "Waterwalk",
    "The Stone of Jordan",
    "Nagelring"
  ],
  "presets": {
    "TEMP_GEAR": {
      "head":   "Griffon's Eye",
      "amulet": "Mara's Kaleidoscope",
      "weapon": "Heart of the Oak",
      "shield": "Spirit",
      "armor":  "Skin of the Vipermagi",
      "gloves": "Magefist",
      "belt":   "Arachnid Mesh",
      "boots":  "Wartraveler",
      "ring1":  "The Stone of Jordan",
      "ring2":  "The Stone of Jordan"
    }
  }
}
```

Later phases add `runewords`, `set_items`, and `custom_items` sections (see below).

---

## Extraction script: `scripts/extract_gear_stats.py` (new)

Reads `data/items_config.json` and D2R raw files. Outputs a `gear` key in `db.json` with:
- `items_by_slot`: `{ head: [{id, name, fcr, mf, allSkills, coldSkills}, ...], ... }`
- `presets`: the named builds from config, passed through as-is

**Display names** are resolved via `data/raw/item-names.json`: its `Key` field matches the
`uniqueitems.txt` first column exactly, and `enUS` is the display string
(e.g. "Wartraveler" → "War Traveler", "Eschuta's temper" → "Eschuta's Temper").

**Gear slot** is derived from the item's `code` column in `uniqueitems.txt`, looked up in
`misc.txt` / `armor.txt` / `weapons.txt`. Rings (`rin`) map to both `ring1` and `ring2`.

**Stat extraction** reads `prop1..propN` / `max1..maxN` columns and accumulates:
- `cast1 / cast2 / cast3` → `fcr` (all three encode FCR% directly)
- `mag%` → `mf` (uses `max` of range — good-roll planning)
- `allskills / sor` → `allSkills` (`sor` = all sorceress skills; sorc-focused app)
- `coldSkills` = 0 for all uniques (none in the current list have cold-only bonuses)

**`scripts/build_db.py`** imports `extract_gear_stats` and merges the result into `db.json`
under a `gear` key before writing.

---

## UI changes (same for all phases)

**`public/js/app.js`**:
- Remove `PRESET_ITEMS` from `./gear-db.js` import
- Add `const PRESET_ITEMS = ref({})` at module level
- In `onMounted` fetch handler: `PRESET_ITEMS.value = db.gear.items_by_slot`
- Remove hardcoded `TARGET_GEAR_PRESETS`; load named presets from `db.gear.presets` instead
- `slotStats` (line ~303) and `getTargetSlotItem` (line ~404): change `PRESET_ITEMS[...]`
  to `PRESET_ITEMS.value[...]`
- Template usages auto-unwrap the ref — no changes needed there
- JS appends `{id: 'custom', name: 'Custom / Other', fcr:0, mf:0, allSkills:0, coldSkills:0}`
  to each slot's list after loading

**`public/js/gear-db.js`**:
- Remove `PRESET_ITEMS` export; keep only `GEAR_SLOTS` (UI structure, not game data)

---

## Phase 1 — Unique items

Implement `extract_gear_stats.py` for `unique_items` only (all of the above). End-to-end:
config → Python extraction → `db.json` → UI loads from `db.json`.

Verify: all slot dropdowns populate correctly; named preset loads; stats match raw data.

---

## Phase 2 — Custom / pseudo-items

Add `custom_items` to `items_config.json` with inline stats (no data file lookup):

```json
"custom_items": {
  "Rare FCR Ring": {"fcr": 10, "mf": 0, "allSkills": 0, "coldSkills": 0}
}
```

D2R internal name used as ID. Script passes stats through without lookup. Slot assignment comes
from where these IDs are referenced in `presets` (or infer from item name if unambiguous).

---

## Phase 3 — Runewords

**Dependency**: `data/raw/runes.txt` and `data/raw/runeword.txt` must be added from D2R game
files (not currently present). `runeword.txt` uses the same `prop/min/max` column format.

Config addition:
```json
"runewords": [
  "Lore",
  "Heart of the Oak",
  "Spirit",
  "Enigma",
  "Wealth"
]
```

Script looks each up in `runeword.txt` by name; extracts stats same way. Display names from
runeword string tables (additional string files may be needed from D2R). Enigma's MF is
`+0.5%/clvl` — flag it specially in output so UI can display "~45% at clvl 90" rather than
a flat value.

---

## Phase 4 — Set items + set bonuses

Config addition:
```json
"set_items": [
  "Tal Rasha's Adjudication",
  "Tal Rasha's Howling Wind",
  "Tal Rasha's Fire-Spun Cloth",
  "Trang-Oul's Claws"
]
```

Script reads `setitems.txt`:
- `prop1..prop9` → base item stats (same extraction logic; **exclude** `aprop*` columns)
- `aprop1a/aprop1b` through `aprop5a/aprop5b` → partial set bonuses:
  `[{pieces: 2, fcr, mf, allSkills, coldSkills}, {pieces: 3, ...}, ...]`

Output in `db.json` includes both base stats and `set_bonuses` list per set item. UI displays
set bonus summary at the bottom of the Gear panel when multiple set pieces are equipped
(planned feature). Check whether `sets.txt` is available for full-set bonuses; may need to
add it to raw data.

Note: `Tal Rasha's Howling Wind` is the internal `setitems.txt` name for what displays as
`Tal Rasha's Guardianship`. Display name resolved via `item-names.json` as usual.

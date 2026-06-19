#!/usr/bin/env python3
"""
extract_gear_stats.py — extract gear item stats from D2R raw data files.

Reads:
  data/items_config.json      — list of unique items and named gear presets
  data/raw/uniqueitems.txt    — item stats (prop/max columns) + item code
  data/raw/armor.txt          — item code → item type code
  data/raw/misc.txt           — item code → item type code
  data/raw/weapons.txt        — item code → item type code
  data/raw/itemtypes.txt      — item type code → BodyLoc + Equiv hierarchy
  data/raw/item-names.json    — internal item name → display name (enUS)

Returns a dict with keys:
  items_by_slot: { slot: [{id, name, fcr, mf, allSkills, coldSkills}, ...], ... }
  presets:       { presetName: { slot: itemId, ... }, ... }
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"
CONFIG = ROOT / "data" / "items_config.json"

# D2R body location codes → app slot names.
# rarm/larm are ambiguous (weapon or shield) — resolved via type hierarchy.
BODY_LOC_TO_SLOT = {
    "head": "head",
    "tors": "armor",
    "neck": "amulet",
    "feet": "boots",
    "glov": "gloves",
    "belt": "belt",
    "rrin": "ring",
    "lrin": "ring",
}

FCR_PROPS        = {"cast1", "cast2", "cast3"}
MF_PROPS         = {"mag%"}
ALL_SKILLS_PROPS = {"allskills", "sor"}
COLD_SKILL_PROPS = {"coldskill"}


def _load_tsv(path: Path) -> list[dict]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t"))


def _build_item_type_index() -> dict[str, dict]:
    """Index itemtypes.txt by Code field."""
    return {row["Code"].strip(): row for row in _load_tsv(RAW / "itemtypes.txt") if row.get("Code", "").strip()}


def _ancestors(type_code: str, type_index: dict[str, dict], _seen: set | None = None) -> set[str]:
    """Return the full set of ancestor type codes for a given type code."""
    if _seen is None:
        _seen = set()
    if type_code in _seen or type_code not in type_index:
        return _seen
    _seen.add(type_code)
    row = type_index[type_code]
    for eq in (row.get("Equiv1", "").strip(), row.get("Equiv2", "").strip()):
        if eq:
            _ancestors(eq, type_index, _seen)
    return _seen


def _bodyloc_to_slot(bl1: str, itype: str, type_index: dict[str, dict]) -> str | None:
    """Resolve a BodyLoc1 value to an app slot name. Returns None if not equippable."""
    if bl1 in BODY_LOC_TO_SLOT:
        return BODY_LOC_TO_SLOT[bl1]
    if bl1 in ("rarm", "larm"):
        anc = _ancestors(itype, type_index)
        return "shield" if "shld" in anc else "weapon"
    return None


def _build_code_to_slot(type_index: dict[str, dict]) -> dict[str, str]:
    """Map item base code → app slot name via armor.txt / misc.txt / weapons.txt."""
    code_to_slot: dict[str, str] = {}

    for src in ("armor", "misc", "weapons"):
        for row in _load_tsv(RAW / f"{src}.txt"):
            code = row.get("code", "").strip()
            itype = row.get("type", "").strip()
            if not code or not itype or itype not in type_index:
                continue

            bl1 = type_index[itype].get("BodyLoc1", "").strip()
            slot = _bodyloc_to_slot(bl1, itype, type_index)
            if slot:
                code_to_slot[code] = slot

    return code_to_slot


def _build_name_lookup() -> dict[str, str]:
    """Map internal item name (Key) → display name (enUS)."""
    data = json.loads((RAW / "item-names.json").read_text(encoding="utf-8-sig"))
    return {entry["Key"]: entry["enUS"] for entry in data if "Key" in entry and "enUS" in entry}


def _itype_to_slot(itype: str, type_index: dict[str, dict]) -> str | None:
    """Resolve an item type code to an app slot name, walking the type hierarchy if needed."""
    if itype not in type_index:
        return None
    type_row = type_index[itype]
    bl1 = type_row.get("BodyLoc1", "").strip()
    slot = _bodyloc_to_slot(bl1, itype, type_index)
    if slot:
        return slot
    for eq in (type_row.get("Equiv1", "").strip(), type_row.get("Equiv2", "").strip()):
        if eq:
            slot = _itype_to_slot(eq, type_index)
            if slot:
                return slot
    # Category types like "shld" have no BodyLoc themselves; identify by ancestry.
    if "shld" in _ancestors(itype, type_index):
        return "shield"
    return None


def _extract_stats(row: dict, prop_col: str = "prop", max_col: str = "max", count: int = 12) -> dict:
    fcr = mf = all_skills = cold_skills = 0
    for i in range(1, count + 1):
        prop = row.get(f"{prop_col}{i}", "").strip()
        try:
            val = int(row.get(f"{max_col}{i}", "") or 0)
        except ValueError:
            val = 0
        if prop in FCR_PROPS:
            fcr += val
        elif prop in MF_PROPS:
            mf += val
        elif prop in ALL_SKILLS_PROPS:
            all_skills += val
        elif prop in COLD_SKILL_PROPS:
            cold_skills += val
    return {"fcr": fcr, "mf": mf, "allSkills": all_skills, "coldSkills": cold_skills}


def _extract_set_level_bonuses(sets_rows: list[dict], set_sizes: dict[str, int]) -> dict[str, list[dict]]:
    """
    Extract set-level partial + full bonuses from sets.txt.
    Returns {set_name: [{pieces, fcr, mf, allSkills, coldSkills}, ...]}
    """
    result: dict[str, list[dict]] = {}
    for row in sets_rows:
        name = row.get("index", "").strip()
        if not name:
            continue
        bonuses: list[dict] = []

        # Partial bonuses: PCode2..PCode5 → N pieces
        for n in range(2, 6):
            stats = {"fcr": 0, "mf": 0, "allSkills": 0, "coldSkills": 0}
            for ab in ("a", "b"):
                prop = row.get(f"PCode{n}{ab}", "").strip()
                try:
                    val = int(row.get(f"PMax{n}{ab}", "") or 0)
                except ValueError:
                    val = 0
                if prop in FCR_PROPS:
                    stats["fcr"] += val
                elif prop in MF_PROPS:
                    stats["mf"] += val
                elif prop in ALL_SKILLS_PROPS:
                    stats["allSkills"] += val
                elif prop in COLD_SKILL_PROPS:
                    stats["coldSkills"] += val
            if any(v > 0 for v in stats.values()):
                bonuses.append({"pieces": n, **stats})

        # Full-set bonus: FCode1..FCode8 → all pieces
        total = set_sizes.get(name, 0)
        if total > 0:
            stats = {"fcr": 0, "mf": 0, "allSkills": 0, "coldSkills": 0}
            for i in range(1, 9):
                prop = row.get(f"FCode{i}", "").strip()
                try:
                    val = int(row.get(f"FMax{i}", "") or 0)
                except ValueError:
                    val = 0
                if prop in FCR_PROPS:
                    stats["fcr"] += val
                elif prop in MF_PROPS:
                    stats["mf"] += val
                elif prop in ALL_SKILLS_PROPS:
                    stats["allSkills"] += val
                elif prop in COLD_SKILL_PROPS:
                    stats["coldSkills"] += val
            if any(v > 0 for v in stats.values()):
                bonuses.append({"pieces": total, **stats})

        if bonuses:
            result[name] = bonuses
    return result


def _extract_set_bonuses(row: dict) -> list[dict]:
    """Extract partial set bonuses from aprop columns. apropN corresponds to N+1 pieces."""
    bonuses = []
    for i in range(1, 6):
        pieces = i + 1
        stats = {"fcr": 0, "mf": 0, "allSkills": 0, "coldSkills": 0}
        for ab in ("a", "b"):
            prop = row.get(f"aprop{i}{ab}", "").strip()
            try:
                val = int(row.get(f"amax{i}{ab}", "") or 0)
            except ValueError:
                val = 0
            if prop in FCR_PROPS:
                stats["fcr"] += val
            elif prop in MF_PROPS:
                stats["mf"] += val
            elif prop in ALL_SKILLS_PROPS:
                stats["allSkills"] += val
            elif prop in COLD_SKILL_PROPS:
                stats["coldSkills"] += val
        if any(v > 0 for v in stats.values()):
            bonuses.append({"pieces": pieces, **stats})
    return bonuses


def extract() -> dict:
    config = json.loads(CONFIG.read_text())
    unique_item_names: list[str] = config.get("unique_items", [])
    runeword_names: list[str] = config.get("runewords", [])
    set_item_names: list[str] = config.get("set_items", [])
    custom_items: dict = config.get("custom_items", {})
    presets: dict = config.get("presets", {})

    type_index = _build_item_type_index()
    code_to_slot = _build_code_to_slot(type_index)
    name_to_display = _build_name_lookup()

    unique_rows: dict[str, dict] = {}
    for row in _load_tsv(RAW / "uniqueitems.txt"):
        idx = row.get("index", "").strip()
        if idx:
            unique_rows[idx] = row

    runeword_rows: dict[str, dict] = {}
    if runeword_names:
        for row in _load_tsv(RAW / "runes.txt"):
            name = row.get("*Rune Name", "").strip()
            if name:
                runeword_rows[name] = row

    all_set_item_rows = _load_tsv(RAW / "setitems.txt")
    set_item_rows: dict[str, dict] = {}
    set_sizes: dict[str, int] = {}
    for row in all_set_item_rows:
        idx = row.get("index", "").strip()
        sname = row.get("set", "").strip()
        if idx:
            set_item_rows[idx] = row
        if sname:
            set_sizes[sname] = set_sizes.get(sname, 0) + 1

    sets_rows = _load_tsv(RAW / "sets.txt")
    set_level_bonuses = _extract_set_level_bonuses(sets_rows, set_sizes)

    items_by_slot: dict[str, list] = {}

    for internal_name in unique_item_names:
        row = unique_rows.get(internal_name)
        if not row:
            raise KeyError(f"'{internal_name}' not found in uniqueitems.txt")

        code = row.get("code", "").strip()
        slot = code_to_slot.get(code)
        if not slot:
            raise KeyError(f"No slot mapping for code '{code}' (item: '{internal_name}')")

        display_name = name_to_display.get(internal_name)
        if not display_name:
            raise KeyError(f"No display name found for '{internal_name}' in item-names.json")

        stats = _extract_stats(row)
        item = {"id": internal_name, "name": display_name, **stats}

        target_slots = ["ring1", "ring2"] if slot == "ring" else [slot]
        for s in target_slots:
            items_by_slot.setdefault(s, []).append(item)

    for rw_name in runeword_names:
        row = runeword_rows.get(rw_name)
        if not row:
            raise KeyError(f"Runeword '{rw_name}' not found in runes.txt")

        slots = []
        seen: set[str] = set()
        for i in range(1, 7):
            itype = row.get(f"itype{i}", "").strip()
            if not itype:
                continue
            slot = _itype_to_slot(itype, type_index)
            if slot and slot not in seen:
                slots.append(slot)
                seen.add(slot)

        if not slots:
            raise KeyError(f"No slot mapping found for runeword '{rw_name}'")

        stats = _extract_stats(row, prop_col="T1Code", max_col="T1Max", count=7)
        item = {"id": rw_name, "name": rw_name, **stats}
        for s in slots:
            items_by_slot.setdefault(s, []).append(item)

    for internal_name in set_item_names:
        row = set_item_rows.get(internal_name)
        if not row:
            raise KeyError(f"'{internal_name}' not found in setitems.txt")

        code = row.get("item", "").strip()
        slot = code_to_slot.get(code)
        if not slot:
            raise KeyError(f"No slot mapping for code '{code}' (set item: '{internal_name}')")

        display_name = name_to_display.get(internal_name)
        if not display_name:
            raise KeyError(f"No display name found for '{internal_name}' in item-names.json")

        set_name = row.get("set", "").strip()
        stats = _extract_stats(row)
        set_bonuses = _extract_set_bonuses(row)
        item: dict = {"id": internal_name, "name": display_name, "set_name": set_name,
                      **stats}
        if set_bonuses:
            item["set_bonuses"] = set_bonuses

        target_slots = ["ring1", "ring2"] if slot == "ring" else [slot]
        for s in target_slots:
            items_by_slot.setdefault(s, []).append(item)

    for item_id, entry in custom_items.items():
        slot = entry.get("slot")
        if not slot:
            raise KeyError(f"Custom item '{item_id}' is missing required 'slot' field")
        stats = {
            "fcr":       entry.get("fcr", 0),
            "mf":        entry.get("mf", 0),
            "allSkills": entry.get("allSkills", 0),
            "coldSkills": entry.get("coldSkills", 0),
        }
        item = {"id": item_id, "name": item_id, **stats}
        target_slots = ["ring1", "ring2"] if slot == "ring" else [slot]
        for s in target_slots:
            items_by_slot.setdefault(s, []).append(item)

    for preset_name, preset_slots in presets.items():
        for slot, item_id in preset_slots.items():
            slot_item_ids = {item["id"] for item in items_by_slot.get(slot, [])}
            if item_id not in slot_item_ids:
                raise KeyError(
                    f"Preset '{preset_name}' slot '{slot}' references item '{item_id}' "
                    f"which is not available for that slot"
                )

    return {"items_by_slot": items_by_slot, "presets": presets,
            "set_level_bonuses": set_level_bonuses}


if __name__ == "__main__":
    result = extract()
    for slot, items in result["items_by_slot"].items():
        print(f"\n{slot}:")
        for item in items:
            print(f"  {item['name']}: fcr={item['fcr']} mf={item['mf']} "
                  f"allSkills={item['allSkills']} coldSkills={item['coldSkills']}")
    print("\nPresets:", list(result["presets"].keys()))

#!/usr/bin/env python3
"""
calculate_drop_odds.py — pre-compute base drop probabilities for D2R farm targets.

For each target monster, walks its TC tree and stores three probability components
per valuable item (all needed because MF affects only the quality roll):

  base_prob           — P(base item type selected from TC tree); MF-independent
  quality_params      — inputs to client-side MF formula:
                        {base_chance, divisor, min_chance, quality_factor, qlvl, quality_type}
  unique_weight /     — specific-unique selection weight; MF-independent;
  unique_total_weight   P(this specific item) = unique_weight / unique_total_weight

Also stores rune_prob (Pul+), gc_prob (Grand Charm), sc_prob (Small Charm).

Targets are read from public/data/run_config.json; only monsters with a monster_id
field are processed (empty monsters lists for unavailable runs are skipped).

Outputs data/drop_odds.json.
"""

import json
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import parse_treasure_classes as ptc

OUT = Path(__file__).parent.parent / "data" / "drop_odds.json"
VALUABLES_PATH = Path(__file__).parent.parent / "data" / "valuables.json"
RUN_CONFIG_PATH = Path(__file__).parent.parent / "public" / "data" / "run_config.json"

# High rune codes: Pul (r21) through Zod (r33)
HIGH_RUNE_CODES = frozenset(f"r{n}" for n in range(21, 34))
GC_CODE = "cm3"
SC_CODE = "cm1"

# Items in valuables.json that are intentionally absent from the TC drop system.
# Annihilus drops from Uber Diablo (token event); Hellfire Torch from Uber Tristram.
# Any other valuable missing from game data is an unexpected failure and will abort the script.
EXPECTED_NOT_IN_GAME_DATA = {"Annihilus", "Hellfire Torch"}


def _normalize(name: str) -> str:
    # Normalize Unicode and collapse curly apostrophes to straight so that
    # valuables.json (Maxroll-scraped, sometimes curly) matches game data (always straight).
    name = unicodedata.normalize("NFC", name).strip()
    return name.replace("‘", "'").replace("’", "'")


def _load_key_to_display() -> dict[str, str]:
    """Return internal string key -> English display name from item-names.json."""
    path = Path(ptc.RAW_DIR) / "item-names.json"
    entries = json.loads(path.read_text(encoding="utf-8-sig"))
    return {e["Key"]: e["enUS"] for e in entries if "Key" in e and "enUS" in e}


def _build_name_to_entry() -> dict[str, dict]:
    """Map display name -> {code, qlvl, rarity, quality_type}.

    Uses item-names.json to resolve internal index keys (e.g. 'Gorerider',
    'Fathom', 'Thudergod\\'s Vigor') to their English display names so that
    the lookup against valuables.json works regardless of key/name mismatches
    in the raw Excel files.
    """
    key_to_display = _load_key_to_display()
    result: dict[str, dict] = {}
    for row in ptc._csv_rows("uniqueitems.txt"):
        index = row.get("index", "").strip()
        code = row.get("code", "").strip()
        if not index or not code or row.get("disabled", "0").strip() == "1":
            continue
        name = _normalize(key_to_display.get(index, index))
        result[name] = {
            "code": code,
            "qlvl": int(row.get("lvl", "0") or "0"),
            "rarity": int(row.get("rarity", "1") or "1"),
            "quality_type": "unique",
        }
    for row in ptc._csv_rows("setitems.txt"):
        index = row.get("index", "").strip()
        code = row.get("item", "").strip()
        if not index or not code or row.get("disabled", "0").strip() == "1":
            continue
        name = _normalize(key_to_display.get(index, index))
        result[name] = {
            "code": code,
            "qlvl": int(row.get("lvl", "0") or "0"),
            "rarity": int(row.get("rarity", "1") or "1"),
            "quality_type": "set",
        }
    return result


def _get_mlvl(target: dict) -> int:
    if target["superunique"]:
        su = ptc._get_superuniques().get(target["monster_id"], {})
        mon = ptc._get_monstats().get(su.get("class", ""))
        return mon.level.get(target["difficulty"], 0) if mon else 0
    mon = ptc._get_monstats().get(target["monster_id"])
    if mon is None:
        raise ValueError(f"Unknown monster: {target['monster_id']!r}")
    return mon.level.get(target["difficulty"], 0)


def _walk_grouped(tc_name: str) -> dict[str, tuple[float, float]]:
    """Walk TC and accumulate per item code: (total_prob, prob-weighted avg quality_factor)."""
    acc: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for code, prob, qf in ptc.walk_tc(tc_name):
        acc[code][0] += prob
        acc[code][1] += prob * qf
    return {
        code: (v[0], v[1] / v[0] if v[0] > 0 else 0.0)
        for code, v in acc.items()
    }


def _compute(target: dict, name_to_entry: dict, valuables: list[str]) -> dict:
    tc_name = ptc.resolve_tc(target["monster_id"], target["difficulty"])
    mlvl = _get_mlvl(target)
    ilvl = min(mlvl, 99)
    grouped = _walk_grouped(tc_name)

    unique_items = ptc._get_unique_items()
    set_items = ptc._get_set_items()

    drops: dict[str, dict] = {}

    for item_name in valuables:
        nname = _normalize(item_name)
        entry = name_to_entry.get(nname)
        if entry is None:
            continue  # pre-validated in main(); only EXPECTED_NOT_IN_GAME_DATA items reach here

        code = entry["code"]
        if code not in grouped:
            continue  # base item type not in this monster's TC tree

        base_prob, avg_qf = grouped[code]
        ratio = ptc.get_item_ratio(code)

        if entry["quality_type"] == "unique":
            pool = [e for e in unique_items.get(code, []) if e.qlvl <= ilvl]
            base_chance, divisor, min_chance = ratio.unique, ratio.unique_divisor, ratio.unique_min
        else:
            pool = [e for e in set_items.get(code, []) if e.qlvl <= ilvl]
            base_chance, divisor, min_chance = ratio.set_, ratio.set_divisor, ratio.set_min

        this_entry = next((e for e in pool if _normalize(e.name) == nname), None)
        if this_entry is None:
            continue  # unique's qlvl exceeds this monster's ilvl

        drops[item_name] = {
            "base_prob": base_prob,
            "quality_params": {
                "base_chance": base_chance,
                "divisor": divisor,
                "min_chance": min_chance,
                "quality_factor": round(avg_qf),
                "qlvl": entry["qlvl"],
                "quality_type": entry["quality_type"],
            },
            "unique_weight": this_entry.rarity,
            "unique_total_weight": sum(e.rarity for e in pool),
        }

    rune_prob = sum(grouped[c][0] for c in HIGH_RUNE_CODES if c in grouped)
    # Raw base-item drop rates for magic-quality charms (skillers, life/resist SCs, etc.).
    # Unique GCs (Gheed's Fortune, Sunder Charms) are already captured in `drops` via
    # the normal unique-item path. Client-side code applies affix-odds to these base rates
    # (e.g. × 1/21 for a skiller GC prefix, × P(valuable SC affixes) for small charms).
    gc_base_prob = grouped.get(GC_CODE, (0.0, 0.0))[0]
    sc_base_prob = grouped.get(SC_CODE, (0.0, 0.0))[0]

    return {
        "mlvl": mlvl,
        "tc": tc_name,
        "drops": drops,
        "rune_prob": rune_prob,
        "gc_base_prob": gc_base_prob,
        "sc_base_prob": sc_base_prob,
    }


def _load_targets() -> list[dict]:
    """Read run_config.json and return a flat list of monster targets to compute."""
    run_config = json.loads(RUN_CONFIG_PATH.read_text())
    seen: set[str] = set()
    targets: list[dict] = []
    for run in run_config["runs"]:
        for mon in run["monsters"]:
            if "monster_id" not in mon or mon["id"] in seen:
                continue
            targets.append({
                "key": mon["id"],
                "monster_id": mon["monster_id"],
                "difficulty": mon["difficulty"],
                "superunique": mon["superunique"],
            })
            seen.add(mon["id"])
    return targets


def main() -> None:
    valuables: list[str] = json.loads(VALUABLES_PATH.read_text())
    name_to_entry = _build_name_to_entry()

    unknown = [v for v in valuables if _normalize(v) not in name_to_entry and v not in EXPECTED_NOT_IN_GAME_DATA]
    if unknown:
        print(f"ERROR: {len(unknown)} valuables not found in game data: {', '.join(unknown)}", file=sys.stderr)
        sys.exit(1)

    targets = _load_targets()
    result: dict = {"monsters": {}}
    for target in targets:
        print(f"Computing {target['key']} ({target['monster_id']}) …")
        data = _compute(target, name_to_entry, valuables)
        data["monster_id"] = target["monster_id"]
        data["difficulty"] = target["difficulty"]
        result["monsters"][target["key"]] = data
        print(
            f"  → {len(data['drops'])} valuables, "
            f"rune_prob={data['rune_prob']:.6f}, "
            f"gc_base_prob={data['gc_base_prob']:.6f}, sc_base_prob={data['sc_base_prob']:.6f}"
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2))
    print(f"\nWrote → {OUT}")


if __name__ == "__main__":
    main()

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

Also stores good_rune_prob (Pul+), gc_prob (Grand Charm), sc_prob (Small Charm),
and sc_valuable_frac (fraction of SCs with at least one valuable affix).

Targets are read from public/data/run_config.json; only monsters with a monster_id
field are processed (empty monsters lists for unavailable runs are skipped).

Outputs data/drop_odds.json.
"""

import json
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

import d2r_data
import run_targets

OUT = Path(__file__).parent.parent / "data" / "drop_odds.json"
VALUABLES_PATH = Path(__file__).parent.parent / "data" / "valuables.json"

# Good rune codes: Pul (r21) through Zod (r33)
GOOD_RUNE_CODES = frozenset(f"r{n}" for n in range(21, 34))
GC_CODE = "cm3"
SC_CODE = "cm1"

# SC affixes considered trade-valuable for a Blizzard Sorc runner (plvl=85 assumed).
# Only the exact max roll counts; dict maps affix name -> (mod_min, mod_max) so we can
# compute P(max roll) = 1 / (mod_max - mod_min + 1) and weight accordingly.
_VALUABLE_SC_PREFIXES = {
    "Shimmering": (3, 5),    # +5 all res (exact max)
}
_VALUABLE_SC_SUFFIXES = {
    "of Good Luck": (6, 7),  # +7% MF (exact max)
    "of Vita":      (16, 20), # +20 life (exact max)
}

# Items in valuables.json that are intentionally absent from the TC drop system.
# Annihilus drops from Uber Diablo (token event); Hellfire Torch from Uber Tristram.
# Any other valuable missing from game data is an unexpected failure and will abort the script.
EXPECTED_NOT_IN_GAME_DATA = {"Annihilus", "Hellfire Torch"}



def _sc_affix_pool(rows: list[dict], ilvl: int) -> dict[int, dict]:
    """Return {group: highest-eligible-row} for SC affixes at the given ilvl.

    D2 affix selection: within each group only the highest-level eligible entry
    (level <= ilvl) enters the pool; entries with frequency=0 are excluded.
    """
    pool: dict[int, dict] = {}
    for row in rows:
        if row.get("spawnable", "").strip() != "1":
            continue
        itypes = [row.get(f"itype{i}", "").strip() for i in range(1, 8)]
        if "scha" not in itypes:
            continue
        try:
            level = int(row.get("level", "0") or "0")
            group = int(row.get("group", "0") or "0")
            freq  = int(row.get("frequency", "0") or "0")
        except ValueError:
            continue
        if level > ilvl or freq == 0:
            continue
        existing = pool.get(group)
        if existing is None or level > int(existing.get("level", "0") or "0"):
            pool[group] = row
    return pool


def compute_sc_valuable_frac(ilvl: int) -> float:
    """P(SC has at least one valuable affix) given item level ilvl.

    Valuable = exact max roll only: Shimmering +5 all res, of Good Luck +7% MF, of Vita +20 life.

    Magic item affix layout (planetdiablo.eu): suffix-only 50%, prefix-only 25%, both 25%.
    So P(has prefix) = 0.50, P(has suffix) = 0.75.
    """
    prefix_rows = d2r_data.csv_rows("magicprefix.txt")
    suffix_rows = d2r_data.csv_rows("magicsuffix.txt")

    prefix_pool = _sc_affix_pool(prefix_rows, ilvl)
    suffix_pool = _sc_affix_pool(suffix_rows, ilvl)

    total_pfx = sum(int(r.get("frequency", 0) or 0) for r in prefix_pool.values())
    total_sfx = sum(int(r.get("frequency", 0) or 0) for r in suffix_pool.values())

    # Effective weight for each valuable affix = pool weight × P(exact max roll).
    # D2 rolls uniformly in [mod_min, mod_max], so P(max) = 1 / (mod_max - mod_min + 1).
    val_pfx_w = 0.0
    for r in prefix_pool.values():
        bounds = _VALUABLE_SC_PREFIXES.get(r.get("Name", "").strip())
        if bounds:
            val_pfx_w += int(r.get("frequency", 0) or 0) / (bounds[1] - bounds[0] + 1)

    val_sfx_w = 0.0
    for r in suffix_pool.values():
        bounds = _VALUABLE_SC_SUFFIXES.get(r.get("Name", "").strip())
        if bounds:
            val_sfx_w += int(r.get("frequency", 0) or 0) / (bounds[1] - bounds[0] + 1)

    p_pfx = val_pfx_w / total_pfx if total_pfx else 0.0
    p_sfx = val_sfx_w / total_sfx if total_sfx else 0.0
    # Three layout cases (planetdiablo.eu): prefix-only 25%, suffix-only 50%, both 25%
    # P(val | prefix-only) = p_pfx
    # P(val | suffix-only) = p_sfx
    # P(val | both)        = p_pfx + p_sfx - p_pfx*p_sfx
    return 0.25 * p_pfx + 0.50 * p_sfx + 0.25 * (p_pfx + p_sfx - p_pfx * p_sfx)


def _normalize(name: str) -> str:
    # Normalize Unicode and collapse curly apostrophes to straight so that
    # valuables.json (Maxroll-scraped, sometimes curly) matches game data (always straight).
    name = unicodedata.normalize("NFC", name).strip()
    return name.replace("‘", "'").replace("’", "'")


def _build_name_to_entry() -> dict[str, dict]:
    """Map display name -> {code, qlvl, rarity, quality_type}.

    Uses item-names.json to resolve internal index keys (e.g. 'Gorerider',
    'Fathom', 'Thudergod\\'s Vigor') to their English display names so that
    the lookup against valuables.json works regardless of key/name mismatches
    in the raw Excel files.
    """
    key_to_display = d2r_data.get_item_names()
    result: dict[str, dict] = {}
    for row in d2r_data.csv_rows("uniqueitems.txt"):
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
    for row in d2r_data.csv_rows("setitems.txt"):
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
        su = d2r_data.get_superuniques().get(target["monster_id"], {})
        mon = d2r_data.get_monstats().get(su.get("class", ""))
        return mon.level.get(target["difficulty"], 0) if mon else 0
    mon = d2r_data.get_monstats().get(target["monster_id"])
    if mon is None:
        raise ValueError(f"Unknown monster: {target['monster_id']!r}")
    return mon.level.get(target["difficulty"], 0)


def _walk_grouped(tc_name: str, nodrop_override: int | None = None) -> dict[str, tuple[float, float]]:
    """Walk TC and accumulate per item code: (total_prob, prob-weighted avg quality_factor)."""
    acc: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for code, prob, qf in d2r_data.walk_tc(tc_name, _nodrop_override=nodrop_override):
        acc[code][0] += prob
        acc[code][1] += prob * qf
    return {
        code: (v[0], v[1] / v[0] if v[0] > 0 else 0.0)
        for code, v in acc.items()
    }


def _compute(target: dict, name_to_entry: dict, valuables: list[str]) -> dict:
    tc_name = d2r_data.resolve_tc(target["monster_id"], target["difficulty"])
    mlvl = _get_mlvl(target)
    ilvl = min(mlvl, 99)
    # Elite monsters (champion/unique) are forced to always drop by the engine (NoDrop=0).
    # The TC data still carries the normal-monster NoDrop, so we override it here.
    nodrop_override = 0 if target.get("elite") else None
    grouped = _walk_grouped(tc_name, nodrop_override=nodrop_override)

    unique_items = d2r_data.get_unique_items()
    set_items = d2r_data.get_set_items()

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
        ratio = d2r_data.get_item_ratio(code)

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

    good_rune_prob = sum(grouped[c][0] for c in GOOD_RUNE_CODES if c in grouped)
    gc_base_prob, gc_avg_qf = grouped.get(GC_CODE, (0.0, 0.0))
    sc_base_prob = grouped.get(SC_CODE, (0.0, 0.0))[0]

    skiller_fraction = d2r_data.get_skiller_gc_fraction(ilvl)
    gc_ratio = d2r_data.get_item_ratio(GC_CODE)
    if gc_base_prob > 0 and gc_avg_qf > 0:
        gc_magic_qc = (gc_ratio.magic - ilvl // gc_ratio.magic_divisor) * 1024 // int(gc_avg_qf) + gc_ratio.magic
        gc_magic_qc = min(gc_magic_qc, gc_ratio.magic_min)
        p_magic_quality = min(1.0, 128 / max(1, gc_magic_qc))
    else:
        p_magic_quality = 1.0
    # P(magic item has a prefix) = 0.5 per planetdiablo.eu: suffix-only 50%, prefix-only 25%, both 25%
    gc_skiller_frac = skiller_fraction * p_magic_quality * 0.5

    sc_valuable_frac = compute_sc_valuable_frac(ilvl)

    return {
        "mlvl": mlvl,
        "tc": tc_name,
        "drops": drops,
        "good_rune_prob": good_rune_prob,
        "gc_base_prob": gc_base_prob,
        "gc_skiller_frac": gc_skiller_frac,
        "sc_base_prob": sc_base_prob,
        "sc_valuable_frac": sc_valuable_frac,
    }


def main() -> None:
    valuables: list[str] = json.loads(VALUABLES_PATH.read_text())
    name_to_entry = _build_name_to_entry()

    unknown = [v for v in valuables if _normalize(v) not in name_to_entry and v not in EXPECTED_NOT_IN_GAME_DATA]
    if unknown:
        print(f"ERROR: {len(unknown)} valuables not found in game data: {', '.join(unknown)}", file=sys.stderr)
        sys.exit(1)

    targets = run_targets.load_targets()
    result: dict = {"monsters": {}}
    for target in targets:
        print(f"Computing {target['key']} ({target['monster_id']}) …")
        data = _compute(target, name_to_entry, valuables)
        data["monster_id"] = target["monster_id"]
        data["difficulty"] = target["difficulty"]
        result["monsters"][target["key"]] = data
        print(
            f"  → {len(data['drops'])} valuables, "
            f"good_rune_prob={data['good_rune_prob']:.6f}, "
            f"gc_base_prob={data['gc_base_prob']:.6f} (skiller_frac={data['gc_skiller_frac']:.4f}), "
            f"sc_base_prob={data['sc_base_prob']:.6f} (valuable_frac={data['sc_valuable_frac']:.4f})"
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2))
    print(f"\nWrote → {OUT}")


if __name__ == "__main__":
    main()

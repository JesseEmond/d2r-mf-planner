#!/usr/bin/env python3
"""
extract_skill_data.py — extract skill synergy and damage data from D2R skills.txt.

Reads:
  data/raw/skills.txt — D2R skill definitions (tab-separated)

Returns a dict keyed by skill name with:
  synergy_pct_per_level — int, % damage bonus granted per level of each synergy skill (par8)
  synergy_skills        — list of skill names acting as synergies (from EDmgSymPerCalc)
  emin / emax           — base damage at skill level 1 (raw internal units)
  emin_lev1-5 / emax_lev1-5 — per-level damage additions for each tier (raw)
  hit_shift             — right-shift applied to raw values: BaseDamage = raw >> (8 - HitShift)

Damage formula (for min damage, identical for max):
  Raw = emin
        + min(max(lvl-1, 0), 7)  * emin_lev1   # tier 1: levels 2-8
        + min(max(lvl-8, 0), 8)  * emin_lev2   # tier 2: levels 9-16
        + min(max(lvl-16, 0), 6) * emin_lev3   # tier 3: levels 17-22
        + min(max(lvl-22, 0), 6) * emin_lev4   # tier 4: levels 23-28
        + max(lvl-28, 0)         * emin_lev5   # tier 5: levels 29+
  BaseDamage = floor(Raw / 2^(8 - hit_shift))
  FinalDamage = floor(BaseDamage * (1 + sum(synergy_skill.blvl) * synergy_pct_per_level/100) * gear_mult)

Note: synergies use HARD POINTS (blvl), not effective level with +skills bonuses.
"""

import csv
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
RAW = ROOT / "data" / "raw"

SKILLS_OF_INTEREST = {"Blizzard", "Ice Blast"}


def _parse_synergy_skills(formula: str) -> list[str]:
    """Extract skill names from an EDmgSymPerCalc expression like:
    (skill('Ice Bolt'.blvl)+skill('Ice Blast'.blvl)+skill('Glacial Spike'.blvl))*par8
    """
    return re.findall(r"skill\('([^']+)'\.blvl\)", formula)


def _int(val: str) -> int | None:
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


def extract() -> dict:
    skills_file = RAW / "skills.txt"
    result = {}

    with open(skills_file, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            name = row.get("skill", "")
            if name not in SKILLS_OF_INTEREST:
                continue

            synergy_formula = row.get("EDmgSymPerCalc", "")
            result[name] = {
                "synergy_pct_per_level": _int(row.get("Param8")),
                "synergy_skills":        _parse_synergy_skills(synergy_formula),
                "emin":                  _int(row.get("EMin")),
                "emax":                  _int(row.get("EMax")),
                "emin_lev1":             _int(row.get("EMinLev1")),
                "emax_lev1":             _int(row.get("EMaxLev1")),
                "emin_lev2":             _int(row.get("EMinLev2")),
                "emax_lev2":             _int(row.get("EMaxLev2")),
                "emin_lev3":             _int(row.get("EMinLev3")),
                "emax_lev3":             _int(row.get("EMaxLev3")),
                "emin_lev4":             _int(row.get("EMinLev4")),
                "emax_lev4":             _int(row.get("EMaxLev4")),
                "emin_lev5":             _int(row.get("EMinLev5")),
                "emax_lev5":             _int(row.get("EMaxLev5")),
                "hit_shift":             _int(row.get("HitShift")),
            }

    missing = SKILLS_OF_INTEREST - result.keys()
    if missing:
        raise ValueError(f"Skills not found in skills.txt: {missing}")

    return result


if __name__ == "__main__":
    import json

    data = extract()
    print(json.dumps(data, indent=2))

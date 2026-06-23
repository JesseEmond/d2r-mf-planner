#!/usr/bin/env python3
"""
Unit tests for the D2R skill damage formula.

Validates that the data extracted from skills.txt + the formula produces exact
in-game damage values observed with:
  - Character: Blizzard Sorceress, Hell
  - Hard points: Blizzard=20, Ice Blast=20, Ice Bolt=20, Glacial Spike=20, Frozen Orb=0
  - Gear: +9 All Skills (from db.json gear totals)
  - Effective skill level: 20 + 9 = 29
  - No +% cold skill damage on gear

In-game readings (character screen, Hell):
  Blizzard per shard: 4220–4452
  Ice Blast per hit:  2091–2167

D2R damage formula:
  Raw = EMin + min(max(L-1,0),7)*Lev1 + min(max(L-8,0),8)*Lev2
             + min(max(L-16,0),6)*Lev3 + min(max(L-22,0),6)*Lev4
             + max(L-28,0)*Lev5
  BaseDamage = floor(Raw / 2^(8 - HitShift))
  FinalDamage = floor(BaseDamage * (1 + sum(synergy_skill.blvl * rate/100)))

Note: synergies use hard points (blvl), NOT effective level with gear bonuses.
"""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import extract_skill_data

# ── Formula helpers ─────────────────────────────────────────────────────────

TIER_CAPS = [7, 8, 6, 6]  # standard D2R per-level tier limits; tier 5 is unlimited

SKILL_HARD_PTS = {
    'Blizzard':      20,
    'Ice Blast':     20,
    'Ice Bolt':      20,
    'Glacial Spike': 20,
    'Frozen Orb':     0,
}


def _raw_damage(base: int, levs: list[int], lvl: int) -> int:
    raw = base
    remaining = lvl - 1
    for i, cap in enumerate(TIER_CAPS + [math.inf]):
        if remaining <= 0:
            break
        in_tier = int(min(remaining, cap))
        raw += in_tier * (levs[i] if i < len(levs) else 0)
        remaining -= in_tier
    return raw


def compute_damage_range(dat: dict, lvl: int, hard_pts: dict) -> tuple[int, int]:
    """Return (min_damage, max_damage) per shard/hit for the given effective skill level."""
    divisor = 2 ** (8 - dat['hit_shift'])
    base_min = math.floor(_raw_damage(
        dat['emin'],
        [dat[f'emin_lev{i}'] for i in range(1, 6)],
        lvl,
    ) / divisor)
    base_max = math.floor(_raw_damage(
        dat['emax'],
        [dat[f'emax_lev{i}'] for i in range(1, 6)],
        lvl,
    ) / divisor)

    rate = dat['synergy_pct_per_level'] / 100
    total_blvl = sum(hard_pts.get(sk, 0) for sk in dat['synergy_skills'])
    synergy_mult = 1 + rate * total_blvl

    return (
        math.floor(base_min * synergy_mult),
        math.floor(base_max * synergy_mult),
    )


# ── Tests ────────────────────────────────────────────────────────────────────

def _skill_data():
    return extract_skill_data.extract()


def test_blizzard_damage_matches_ingame():
    """Blizzard shard damage at effective lvl 29 matches in-game reading 4220–4452."""
    dat = _skill_data()['Blizzard']
    dmg_min, dmg_max = compute_damage_range(dat, lvl=29, hard_pts=SKILL_HARD_PTS)
    assert dmg_min == 4220, f"Blizzard min: expected 4220, got {dmg_min}"
    assert dmg_max == 4452, f"Blizzard max: expected 4452, got {dmg_max}"


def test_ice_blast_damage_matches_ingame():
    """Ice Blast damage at effective lvl 29 matches in-game reading 2091–2167."""
    dat = _skill_data()['Ice Blast']
    dmg_min, dmg_max = compute_damage_range(dat, lvl=29, hard_pts=SKILL_HARD_PTS)
    assert dmg_min == 2091, f"Ice Blast min: expected 2091, got {dmg_min}"
    assert dmg_max == 2167, f"Ice Blast max: expected 2167, got {dmg_max}"


def test_synergy_uses_hard_points_not_effective_level():
    """Synergy with effective level (29) gives wrong results; blvl (20) gives correct ones."""
    dat = _skill_data()['Ice Blast']

    # Using blvl=20 → correct
    dmg_min_blvl, _ = compute_damage_range(dat, lvl=29, hard_pts=SKILL_HARD_PTS)

    # Using effective level as blvl (wrong) → different result
    wrong_hard_pts = {k: v + 9 for k, v in SKILL_HARD_PTS.items()}
    dmg_min_lvl, _ = compute_damage_range(dat, lvl=29, hard_pts=wrong_hard_pts)

    assert dmg_min_blvl == 2091
    assert dmg_min_lvl != 2091, "Using effective level should NOT match in-game value"


def test_blizzard_hitshift_no_division():
    """Blizzard HitShift=8 means raw value is used directly (divide by 1)."""
    dat = _skill_data()['Blizzard']
    assert dat['hit_shift'] == 8


def test_ice_blast_hitshift_divides_by_two():
    """Ice Blast HitShift=7 means raw value is divided by 2."""
    dat = _skill_data()['Ice Blast']
    assert dat['hit_shift'] == 7


def test_blizzard_synergy_skills():
    """Blizzard synergy sources: Ice Bolt, Ice Blast, Glacial Spike."""
    dat = _skill_data()['Blizzard']
    assert set(dat['synergy_skills']) == {'Ice Bolt', 'Ice Blast', 'Glacial Spike'}
    assert dat['synergy_pct_per_level'] == 5


def test_ice_blast_synergy_skills():
    """Ice Blast synergy sources: Ice Bolt, Blizzard, Frozen Orb."""
    dat = _skill_data()['Ice Blast']
    assert set(dat['synergy_skills']) == {'Ice Bolt', 'Blizzard', 'Frozen Orb'}
    assert dat['synergy_pct_per_level'] == 8

#!/usr/bin/env python3
"""
Spot-check drop odds against community-benchmarked values.

Validates that the Python pipeline's output (public/data/db.json) matches
known drop rates from community D2R drop calculators, confirming the TC walk,
quality-factor computation, and item-selection weights are correct.

Reference values (Harlequin Crest from Hell Andariel):
  0 MF  → ~1:2396
  100 MF → ~1:1401
  200 MF → ~1:1137
  300 MF → ~1:1016

Quality formula (D2R, integer math):
  eff_mf  = raw_mf * 250 // (raw_mf + 250)          [unique; set uses 500]
  base_qc = (base_chance - mlvl // divisor) * 1024 // quality_factor + base_chance
  qc      = min(base_qc * 100 // (100 + eff_mf), min_chance)
  P(quality = unique) = 128 / qc
"""

import json
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "db.json"

sys.path.insert(0, str(Path(__file__).parent.parent))
import d2r_data


def _load_db() -> dict:
    return json.loads(DB_PATH.read_text())


def _eff_mf(raw_mf: int, quality_type: str) -> int:
    """D2R effective MF after diminishing returns."""
    cap = 500 if quality_type == "set" else 250
    return (raw_mf * cap) // (raw_mf + cap) if raw_mf > 0 else 0


def _p_drop(item: dict, mlvl: int, raw_mf: int) -> float:
    """Probability of a specific unique/set item dropping per kill.

    item: entry from db.json monsters.<key>.drops.<name>
    mlvl: monster level (from db.json monsters.<key>.mlvl)
    raw_mf: player's raw Magic Find%
    """
    qp = item["quality_params"]
    base_chance = qp["base_chance"]
    divisor = qp["divisor"]
    quality_factor = qp["quality_factor"]
    min_chance = qp["min_chance"]
    quality_type = qp["quality_type"]

    eff = _eff_mf(raw_mf, quality_type)

    # Base quality chance from monster level and TC quality bonus.
    base_qc = (base_chance - mlvl // divisor) * 1024 // quality_factor + base_chance
    # MF scales the chance down (making unique quality more likely).
    qc = base_qc * 100 // (100 + eff)
    # min_chance caps qc, preventing unique items from being too rare on weak TCs.
    qc = min(qc, min_chance)

    p_quality = 128 / qc
    p_selection = item["unique_weight"] / item["unique_total_weight"]
    return item["base_prob"] * p_quality * p_selection


def _assert_approx_n(actual_n: float, expected_n: int, tol: float = 0.05, label: str = "") -> None:
    rel = abs(actual_n - expected_n) / expected_n
    assert rel <= tol, (
        f"{label}got 1:{actual_n:.0f}, expected ~1:{expected_n} (diff {rel*100:.1f}% > {tol*100:.0f}%)"
    )


# ---------------------------------------------------------------------------
# Structure
# ---------------------------------------------------------------------------

def test_db_structure():
    db = _load_db()
    assert "valuables" in db
    assert "monsters" in db
    andy = db["monsters"]["andy"]
    assert andy["mlvl"] == 75
    assert andy["tc"] == "Andarielq (H)"
    assert len(andy["drops"]) >= 38


def test_all_base_probs_in_range():
    """Every item's base_prob is a valid probability (0, 1]."""
    db = _load_db()
    for mkey, monster in db["monsters"].items():
        for iname, item in monster["drops"].items():
            bp = item["base_prob"]
            assert 0 < bp <= 1.0, f"{mkey}/{iname}: base_prob={bp}"


# ---------------------------------------------------------------------------
# Harlequin Crest (Shako) — primary benchmark
# ---------------------------------------------------------------------------

def test_shako_base_prob():
    """Armet (uap) base item drop rate from Andy is the correct raw TC probability."""
    db = _load_db()
    item = db["monsters"]["andy"]["drops"]["Harlequin Crest"]
    assert abs(item["base_prob"] - 0.002410) < 0.0001


def test_shako_quality_params():
    """Quality params match D2R itemratio.txt for non-class-specific armor (Version 1)."""
    db = _load_db()
    qp = db["monsters"]["andy"]["drops"]["Harlequin Crest"]["quality_params"]
    assert qp["base_chance"] == 400
    assert qp["divisor"] == 1
    assert qp["min_chance"] == 6400
    assert qp["quality_factor"] == 983   # Andy's TC Unique field
    assert qp["qlvl"] == 69
    assert qp["quality_type"] == "unique"


def test_shako_selection_weight():
    """Shako is the only unique armet (uap), so w == W == 1."""
    db = _load_db()
    item = db["monsters"]["andy"]["drops"]["Harlequin Crest"]
    assert item["unique_weight"] == 1
    assert item["unique_total_weight"] == 1


def test_shako_drop_rate_0_mf():
    """Harlequin Crest from Hell Andy at 0 MF is ~1:2396."""
    db = _load_db()
    andy = db["monsters"]["andy"]
    p = _p_drop(andy["drops"]["Harlequin Crest"], andy["mlvl"], raw_mf=0)
    _assert_approx_n(1 / p, 2396, label="Shako 0 MF: ")


def test_shako_drop_rate_100_mf():
    """Harlequin Crest from Hell Andy at 100 MF is ~1:1401."""
    db = _load_db()
    andy = db["monsters"]["andy"]
    p = _p_drop(andy["drops"]["Harlequin Crest"], andy["mlvl"], raw_mf=100)
    _assert_approx_n(1 / p, 1401, label="Shako 100 MF: ")


def test_shako_drop_rate_200_mf():
    """Harlequin Crest from Hell Andy at 200 MF is ~1:1137."""
    db = _load_db()
    andy = db["monsters"]["andy"]
    p = _p_drop(andy["drops"]["Harlequin Crest"], andy["mlvl"], raw_mf=200)
    _assert_approx_n(1 / p, 1137, label="Shako 200 MF: ")


def test_shako_drop_rate_300_mf():
    """Harlequin Crest from Hell Andy at 300 MF is ~1:1016."""
    db = _load_db()
    andy = db["monsters"]["andy"]
    p = _p_drop(andy["drops"]["Harlequin Crest"], andy["mlvl"], raw_mf=300)
    _assert_approx_n(1 / p, 1016, label="Shako 300 MF: ")


# ---------------------------------------------------------------------------
# Gheed's Fortune — tests unique_weight / unique_total_weight selection
# ---------------------------------------------------------------------------

LATENT_SUNDERS = [
    "Latent Cold Rupture",
    "Latent Flame Rift",
    "Latent Crack of the Heavens",
    "Latent Bone Break",
]

def test_gheed_selection_weight():
    """Gheed's Fortune is 1-of-7 in the Unique GC pool (Gheed's + 6 Latent Sunders)."""
    db = _load_db()
    item = db["monsters"]["andy"]["drops"]["Gheed's Fortune"]
    assert item["unique_weight"] == 1
    assert item["unique_total_weight"] == 7, (
        f"Expected 7 unique GCs (Gheed's + 6 Latent Sunders), got {item['unique_total_weight']}"
    )


def test_latent_sunders_in_andy_drops():
    """All 6 Latent Sunder Charms appear in Andy's drops (patch 3.2: any monster can drop them)."""
    db = _load_db()
    drops = db["monsters"]["andy"]["drops"]
    for name in LATENT_SUNDERS:
        assert name in drops, f"{name} missing from Andy's drops"


def test_latent_sunder_selection_weight():
    """Each Latent Sunder is 1-of-7 in the Unique GC pool, equal to Gheed's."""
    db = _load_db()
    drops = db["monsters"]["andy"]["drops"]
    for name in LATENT_SUNDERS:
        item = drops[name]
        assert item["unique_weight"] == 1
        assert item["unique_total_weight"] == 7, (
            f"{name}: unique_total_weight={item['unique_total_weight']}, expected 7"
        )


def test_latent_sunder_same_base_prob_as_gheed():
    """Latent Sunders share the same base_prob as Gheed's (same cm3 TC path)."""
    db = _load_db()
    drops = db["monsters"]["andy"]["drops"]
    gheed_prob = drops["Gheed's Fortune"]["base_prob"]
    for name in LATENT_SUNDERS:
        assert drops[name]["base_prob"] == gheed_prob, (
            f"{name}: base_prob={drops[name]['base_prob']}, expected {gheed_prob}"
        )


# ---------------------------------------------------------------------------
# Rune and charm base probabilities
# ---------------------------------------------------------------------------

def test_good_rune_prob_nonzero_and_small():
    """Andy drops good runes (Pul+) rarely but with a nonzero probability."""
    db = _load_db()
    good_rune_prob = db["monsters"]["andy"]["good_rune_prob"]
    assert 0 < good_rune_prob < 0.01


def test_gc_and_sc_base_prob_equal():
    """Grand Charm and Small Charm have the same base drop rate from Andy's TC."""
    db = _load_db()
    andy = db["monsters"]["andy"]
    assert andy["gc_base_prob"] == andy["sc_base_prob"]
    assert andy["gc_base_prob"] > 0


# ---------------------------------------------------------------------------
# GC skiller fraction and SC valuable fraction
# ---------------------------------------------------------------------------

def test_skiller_fraction_plausible():
    """About 1-in-10 to 1-in-15 magic GCs are any-class skillers at ilvl 99 (community benchmark)."""
    frac = d2r_data.get_skiller_gc_fraction(ilvl=99)
    assert 0.03 <= frac <= 0.20, f"skiller_fraction={frac:.4f} outside expected range [0.03, 0.20]"


def test_skiller_fraction_zero_below_ilvl50():
    """No skiller prefixes can roll below ilvl 50."""
    frac = d2r_data.get_skiller_gc_fraction(ilvl=49)
    assert frac == 0.0, f"Expected 0.0 skiller fraction at ilvl 49, got {frac}"


def test_gc_skiller_frac_nonzero_and_less_than_one():
    """Andy's gc_skiller_frac is a small positive fraction."""
    db = _load_db()
    andy = db["monsters"]["andy"]
    frac = andy["gc_skiller_frac"]
    assert 0 < frac < 1, f"gc_skiller_frac={frac} should be in (0, 1)"


def test_sc_valuable_frac_nonzero_and_less_than_one():
    """Andy's sc_valuable_frac is a small positive fraction (Shimmering, of Good Luck, of Vita)."""
    db = _load_db()
    frac = db["monsters"]["andy"]["sc_valuable_frac"]
    assert 0 < frac < 1, f"sc_valuable_frac={frac} should be in (0, 1)"



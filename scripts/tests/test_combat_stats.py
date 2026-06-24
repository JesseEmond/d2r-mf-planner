#!/usr/bin/env python3
"""
Spot-check combat stats (HP, resistances) against community-verified values.

HP formulas tested here:
  Act bosses:    avg(MinHP, MaxHP) * L-HP(H)[level] / 100
  SU bosses:     avg(MinHP, MaxHP) * HP(H)[level] / 100 * 2.0
  SU minions:    same base * 1.5

References:
  Andariel Hell HP ~60,031: https://diablo2.wiki.fextralife.com/Andariel
  Council member base HP / SU HP: docs/combat_mechanics.md
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import extract_combat_stats
import d2r_data

DB_PATH = Path(__file__).parent.parent.parent / "public" / "data" / "db.json"


def _load_db() -> dict:
    return json.loads(DB_PATH.read_text())


# ---------------------------------------------------------------------------
# Andariel — primary benchmark (community wiki: 60,031 HP, 66% cold resist)
# ---------------------------------------------------------------------------

def test_andy_hp_matches_wiki():
    """Andariel Hell HP via monlvl.txt formula matches community wiki exactly.

    avg(1193, 1193) * L-HP(H)[75] / 100 = 1193 * 5032 / 100 = 60,031.
    """
    stats = extract_combat_stats._get_combat_stats('andariel', 'hell', superunique=False)
    assert stats['hp'] == 60_031, f"Expected 60031, got {stats['hp']}"


def test_andy_cold_resist():
    """Andariel Hell cold resistance is 66% (ResCo(H) from monstats.txt)."""
    stats = extract_combat_stats._get_combat_stats('andariel', 'hell', superunique=False)
    assert stats['cold_resist'] == 66


def test_andy_combat_in_db():
    """db.json includes combat block for andy with correct HP and cold resist."""
    db = _load_db()
    combat = db['monsters']['andy']['combat']
    assert combat['hp'] == 60_031
    assert combat['cold_resist'] == 66


# ---------------------------------------------------------------------------
# Trav super-unique bosses — SU formula: HP(H) * 2.0, minions * 1.5
# councilmember base: avg(200, 350) * HP(H)[88] / 100 = 275 * 4895 / 100 = 13,461
# boss: 13,461 * 2 = 26,922  |  minion: 13,461 * 1.5 = 20,191
# p_cold_immune: 2/13 ≈ 0.1538  (none have cold as a preset mod)
# ---------------------------------------------------------------------------

def test_ismail_boss_hp():
    """Ismail Vilehand Hell HP uses SU formula: base * 2.0."""
    stats = extract_combat_stats._get_combat_stats('Ismail Vilehand', 'hell', superunique=True)
    assert stats['hp'] == 26_922, f"Expected 26922, got {stats['hp']}"


def test_ismail_minion_hp():
    """Ismail minions use SU minion formula: base * 1.5."""
    stats = extract_combat_stats._get_combat_stats('Ismail Vilehand', 'hell', superunique=True)
    assert stats['minions']['count'] == 2
    assert stats['minions']['hp'] == 20_191, f"Expected 20191, got {stats['minions']['hp']}"


def test_ismail_p_cold_immune():
    """Ismail has no preset cold mod; p_cold_immune = 2/13 from the random pool."""
    stats = extract_combat_stats._get_combat_stats('Ismail Vilehand', 'hell', superunique=True)
    expected = 2 / 13
    assert abs(stats['p_cold_immune'] - expected) < 1e-9, f"Expected {expected}, got {stats['p_cold_immune']}"


def test_su_combat_shape():
    """Super-unique combat block includes hp, cold_resist, p_cold_immune, and minions."""
    stats = extract_combat_stats._get_combat_stats('Bremm Sparkfist', 'hell', superunique=True)
    assert 'hp' in stats
    assert 'cold_resist' in stats
    assert 'p_cold_immune' in stats
    assert 'minions' in stats
    assert 'count' in stats['minions']
    assert 'hp' in stats['minions']

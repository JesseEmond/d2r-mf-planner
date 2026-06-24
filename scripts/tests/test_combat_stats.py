#!/usr/bin/env python3
"""
Spot-check combat stats (HP, resistances) against community-verified values.

Validates that the monlvl.txt formula produces correct monster HP:
  HP = avg(MinHP(diff), MaxHP(diff)) * L-HP(diff)[Level(diff)] / 100

References:
  Andariel Hell HP ~60,031: https://diablo2.wiki.fextralife.com/Andariel
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
    stats = extract_combat_stats._get_combat_stats('andariel', 'hell')
    assert stats['hp'] == 60_031, f"Expected 60031, got {stats['hp']}"


def test_andy_cold_resist():
    """Andariel Hell cold resistance is 66% (ResCo(H) from monstats.txt)."""
    stats = extract_combat_stats._get_combat_stats('andariel', 'hell')
    assert stats['cold_resist'] == 66


def test_andy_combat_in_db():
    """db.json includes combat block for andy with correct HP and cold resist."""
    db = _load_db()
    combat = db['monsters']['andy']['combat']
    assert combat['hp'] == 60_031
    assert combat['cold_resist'] == 66



"""
run_targets.py — shared helper for loading monster targets from run_config.json.

Used by calculate_drop_odds.py and extract_combat_stats.py so both scripts
operate on the same set of monsters.
"""

import json
from pathlib import Path

RUN_CONFIG_PATH = Path(__file__).parent.parent / "public" / "data" / "run_config.json"


def load_targets() -> list[dict]:
    """Read run_config.json and return a flat list of unique monster targets.

    Each entry: {key, monster_id, difficulty, superunique}.
    Monsters without a monster_id (e.g. placeholder entries) are skipped.
    """
    run_config = json.loads(RUN_CONFIG_PATH.read_text())
    seen: set[str] = set()
    targets: list[dict] = []
    for mon in run_config.get("minion_monsters", []):
        if "monster_id" not in mon or mon["id"] in seen:
            continue
        targets.append({
            "key": mon["id"],
            "monster_id": mon["monster_id"],
            "difficulty": mon["difficulty"],
            "superunique": mon.get("superunique", False),
        })
        seen.add(mon["id"])
    for run in run_config["runs"]:
        difficulty = run["difficulty"]
        for pack in run.get("monster_packs", []):
            for mon in pack["monsters"]:
                if "monster_id" not in mon or mon["id"] in seen:
                    continue
                targets.append({
                    "key": mon["id"],
                    "monster_id": mon["monster_id"],
                    "difficulty": difficulty,
                    "superunique": mon["superunique"],
                })
                seen.add(mon["id"])
    return targets



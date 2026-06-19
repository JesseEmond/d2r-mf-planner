#!/usr/bin/env python3
"""
build_db.py — assemble public/data/db.json from intermediate pipeline outputs.

Reads:
  data/valuables.json   — list of trade-value item names (scrape_valuables.py)
  data/drop_odds.json   — per-monster drop probabilities (calculate_drop_odds.py)

Writes:
  public/data/db.json   — merged output consumed by the frontend
"""

import json
from pathlib import Path

import extract_gear_stats
import parse_treasure_classes as ptc

ROOT = Path(__file__).parent.parent
VALUABLES_IN = ROOT / "data" / "valuables.json"
DROP_ODDS_IN = ROOT / "data" / "drop_odds.json"
OUT = ROOT / "public" / "data" / "db.json"


def main() -> None:
    valuables: list[str] = json.loads(VALUABLES_IN.read_text())
    drop_odds: dict = json.loads(DROP_ODDS_IN.read_text())

    monsters = drop_odds["monsters"]
    for entry in monsters.values():
        monster_id = entry.get("monster_id")
        difficulty = entry.get("difficulty", "hell")
        if monster_id:
            stats = ptc.get_monster_combat_stats(monster_id, difficulty)
            if stats["hp"]:
                entry["combat"] = stats

    gear = extract_gear_stats.extract()

    db = {
        "valuables": valuables,
        "monsters": monsters,
        "gear": gear,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(db, indent=2))
    print(f"Wrote {len(valuables)} valuables, {len(db['monsters'])} monsters → {OUT}")


if __name__ == "__main__":
    main()

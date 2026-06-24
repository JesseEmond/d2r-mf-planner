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

import extract_combat_stats
import extract_gear_stats
import extract_skill_data
import run_targets

ROOT = Path(__file__).parent.parent
VALUABLES_IN = ROOT / "data" / "valuables.json"
DROP_ODDS_IN = ROOT / "data" / "drop_odds.json"
OUT = ROOT / "public" / "data" / "db.json"


def main() -> None:
    valuables: list[str] = json.loads(VALUABLES_IN.read_text())
    drop_odds: dict = json.loads(DROP_ODDS_IN.read_text())

    monsters = drop_odds["monsters"]
    combat = extract_combat_stats.extract(run_targets.load_targets())
    for key, entry in monsters.items():
        if key in combat:
            entry["combat"] = combat[key]

    gear = extract_gear_stats.extract()
    skill_data = extract_skill_data.extract()

    db = {
        "valuables": valuables,
        "monsters": monsters,
        "gear": gear,
        "skill_data": skill_data,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(db, indent=2))
    print(f"Wrote {len(valuables)} valuables, {len(db['monsters'])} monsters → {OUT}")


if __name__ == "__main__":
    main()

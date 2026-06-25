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
RUN_CONFIG_IN = ROOT / "public" / "data" / "run_config.json"
OUT = ROOT / "public" / "data" / "db.json"


def _build_runs(run_config_data: dict, monsters: dict, minion_id_to_key: dict) -> dict:
    """Compile per-run pack structure for the frontend.

    Each run entry contains monster_packs: a list of packs with probability
    and the monsters in that pack (id, label, amount). Named monsters are
    resolved via db.monsters[id]; minions from combat.minions are expanded
    inline as {id, label, amount, hp, is_minion: true}.

    Minion entries also get a drops_from field pointing to the db.monsters key
    whose drop data should be used. This is derived from combat.minions.monster_id
    (the SU class, which is the minion type) via minion_id_to_key.
    """
    runs: dict = {}
    for run in run_config_data["runs"]:
        packs = []
        for pack in run.get("monster_packs", []):
            pack_monsters = []
            for m in pack["monsters"]:
                raw = m.get("label") or m.get("monster_id", m["id"])
                label = raw if raw != raw.lower() else raw.replace("_", " ").title()
                if m.get("elite"):
                    label = f"Elite {label}"
                pack_monsters.append({"id": m["id"], "label": label, "amount": m.get("amount", 1)})
                # Expand minions inline, deriving drops_from via the minion's monstats class
                mon_combat = monsters.get(m["id"], {}).get("combat", {})
                if mon_combat.get("minions"):
                    minions = mon_combat["minions"]
                    minion_entry: dict = {
                        "id": m["id"] + "_minion",
                        "label": label + " Minion",
                        "amount": minions["count"] * m.get("amount", 1),
                        "hp": minions["hp"],
                        "is_minion": True,
                    }
                    drops_key = minion_id_to_key.get(minions.get("monster_id", ""))
                    if drops_key:
                        minion_entry["drops_from"] = drops_key
                    pack_monsters.append(minion_entry)
            entry: dict = {"probability": pack["probability"], "monsters": pack_monsters}
            if pack.get("room_pack"):
                entry["room_pack"] = True
            named = [m for m in pack["monsters"] if not m.get("is_minion")]
            if named and all(m.get("elite") for m in named):
                entry["elite_group"] = True
            packs.append(entry)
        runs[run["id"]] = {"monster_packs": packs}
    return runs


def main() -> None:
    valuables: list[str] = json.loads(VALUABLES_IN.read_text())
    drop_odds: dict = json.loads(DROP_ODDS_IN.read_text())
    run_config_data: dict = json.loads(RUN_CONFIG_IN.read_text())

    targets = run_targets.load_targets()
    monsters = drop_odds["monsters"]
    combat = extract_combat_stats.extract(targets)
    for key, entry in monsters.items():
        if key in combat:
            entry["combat"] = combat[key]

    # Reverse map: monstats ID -> db.monsters key (used to find drops_from for minions)
    minion_id_to_key = {t["monster_id"]: t["key"] for t in targets}

    gear = extract_gear_stats.extract()
    skill_data = extract_skill_data.extract()
    runs = _build_runs(run_config_data, monsters, minion_id_to_key)

    db = {
        "valuables": valuables,
        "monsters": monsters,
        "runs": runs,
        "gear": gear,
        "skill_data": skill_data,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(db, indent=2))
    print(f"Wrote {len(valuables)} valuables, {len(db['monsters'])} monsters, {len(runs)} runs → {OUT}")


if __name__ == "__main__":
    main()

"""
extract_combat_stats.py — extract per-monster HP and cold resistance from D2R txt files.

Public API:
  extract(targets) -> dict[key, {hp, cold_resist}]

HP formula: avg(minHP, maxHP) * L-HP(difficulty)[monster_level] / 100
Uses the L-HP column from monlvl.txt, which applies to boss/named monsters.
"""

import d2r_data


def _get_combat_stats(monster_id: str, difficulty: str = 'hell') -> dict:
    suffix = {'normal': '', 'nightmare': '(N)', 'hell': '(H)'}[difficulty]
    lhp_col = {'normal': 'L-HP', 'nightmare': 'L-HP(N)', 'hell': 'L-HP(H)'}[difficulty]
    lvl_col = {'normal': 'Level', 'nightmare': 'Level(N)', 'hell': 'Level(H)'}[difficulty]

    def _ri(row: dict, col: str) -> int:
        v = row.get(col, '') or ''
        try:
            return int(v.strip())
        except ValueError:
            return 0

    monlvl = d2r_data.get_monlvl()

    superuniques = d2r_data.get_superuniques()
    if monster_id in superuniques:
        monster_id = superuniques[monster_id].get('class', monster_id)

    for row in d2r_data.csv_rows('monstats.txt'):
        if row.get('Id', '').strip() != monster_id:
            continue
        min_hp = _ri(row, f'MinHP{suffix}' if suffix else 'minHP')
        max_hp = _ri(row, f'MaxHP{suffix}' if suffix else 'maxHP')
        avg_hp = (min_hp + max_hp) // 2
        cold_resist = _ri(row, f'ResCo{suffix}' if suffix else 'ResCo')
        level = _ri(row, lvl_col if suffix else 'Level')
        lhp_scale = monlvl.get(level, {}).get(lhp_col, 100)
        return {'hp': avg_hp * lhp_scale // 100, 'cold_resist': cold_resist}

    return {'hp': 0, 'cold_resist': 0}


def extract(targets: list[dict]) -> dict[str, dict]:
    """Return combat stats keyed by target key for all targets with a monster_id."""
    result: dict[str, dict] = {}
    for target in targets:
        stats = _get_combat_stats(target['monster_id'], target['difficulty'])
        if stats['hp']:
            result[target['key']] = stats
    return result

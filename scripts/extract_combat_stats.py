"""
extract_combat_stats.py — extract per-monster HP and cold resistance from D2R txt files.

Public API:
  extract(targets) -> dict[key, combat_dict]

HP formulas:
  Act bosses (Andy, Meph, …): avg(minHP, maxHP) * monlvl[level].L-HP(difficulty) / 100
  Super-unique bosses:         avg(minHP, maxHP) * monlvl[level].HP(difficulty) / 100 * 2.0
  Their minions:               same base * 1.5

The L-HP vs HP column distinction matters: act bosses' MinHP/MaxHP are designed around
the L-HP scaling; regular monsters' MinHP/MaxHP are designed around HP scaling.
Source: docs/combat_mechanics.md — Base HP Calculation section.

Engine constants (not in any data file):
  Super-unique boss HP multiplier: 2.0x  (maxroll.gg/d2/resources/elite-monster)
  Minion HP multiplier:            1.5x
  Cold Enchanted adds:            +75 cold resist
  Random mods on Hell SU:          2
"""

import d2r_data

# Engine constants — source: maxroll.gg/d2/resources/elite-monster
_SU_BOSS_HP_MULT = 2.0
_SU_MINION_HP_MULT = 1.5
_COLD_MOD_ID = 18          # +75 cold resist; makes council (base 33%) cold immune
_N_RANDOM_HELL_SU = 2      # random mods drawn for super-unique bosses on Hell


def _p_cold_immune_su(preset_mod_ids: list[int]) -> float:
    """P(cold immune) for a hell super-unique via its 2 random mods.

    Returns 1.0 if cold (id=18) is a preset mod, else N/pool_size (equal weights).
    """
    if _COLD_MOD_ID in preset_mod_ids:
        return 1.0
    pool = [m for m in d2r_data.get_monumod().values() if m.upick_hell > 0]
    return _N_RANDOM_HELL_SU / len(pool) if pool else 0.0


def _p_cold_immune_elite() -> float:
    """P(cold immune) for a Hell elite (champion/unique) via 2 random mods."""
    pool = [m for m in d2r_data.get_monumod().values() if m.upick_hell > 0]
    return _N_RANDOM_HELL_SU / len(pool) if pool else 0.0


def _get_combat_stats(monster_id: str, difficulty: str, superunique: bool, elite: bool = False) -> dict:
    suffix = {'normal': '', 'nightmare': '(N)', 'hell': '(H)'}[difficulty]
    lvl_col = {'normal': 'Level', 'nightmare': 'Level(N)', 'hell': 'Level(H)'}[difficulty]
    # Act bosses use L-HP; SU bosses (treated as regular base + elite mult) use HP.
    hp_col = (
        {'normal': 'HP', 'nightmare': 'HP(N)', 'hell': 'HP(H)'}[difficulty]
        if superunique else
        {'normal': 'L-HP', 'nightmare': 'L-HP(N)', 'hell': 'L-HP(H)'}[difficulty]
    )

    def _ri(row: dict, col: str) -> int:
        v = row.get(col, '') or ''
        try:
            return int(v.strip())
        except ValueError:
            return 0

    monlvl = d2r_data.get_monlvl()
    superuniques = d2r_data.get_superuniques()

    su_data = superuniques.get(monster_id) if superunique else None
    monstats_id = su_data['class'] if su_data else monster_id

    for row in d2r_data.csv_rows('monstats.txt'):
        if row.get('Id', '').strip() != monstats_id:
            continue
        min_hp = _ri(row, f'MinHP{suffix}' if suffix else 'minHP')
        max_hp = _ri(row, f'MaxHP{suffix}' if suffix else 'maxHP')
        avg_hp = (min_hp + max_hp) // 2
        cold_resist = _ri(row, f'ResCo{suffix}' if suffix else 'ResCo')
        level = _ri(row, lvl_col if suffix else 'Level')
        scale = monlvl.get(level, {}).get(hp_col, 100)
        base_hp = avg_hp * scale // 100

        if superunique and su_data:
            preset_mods = su_data.get('preset_mods', [])
            minion_count = su_data.get('min_grp', 0)  # min_grp == max_grp for all Trav SUs
            result: dict = {
                'hp': int(base_hp * _SU_BOSS_HP_MULT),
                'cold_resist': cold_resist,
                'p_cold_immune': _p_cold_immune_su(preset_mods),
            }
            if minion_count > 0:
                result['minions'] = {
                    'count': minion_count,
                    'hp': int(base_hp * _SU_MINION_HP_MULT),
                    'monster_id': monstats_id,  # class of the minion (= SU's own class)
                }
            return result

        base_result = {'hp': base_hp, 'cold_resist': cold_resist}
        if elite and cold_resist + 75 >= 100:
            base_result['p_cold_immune'] = _p_cold_immune_elite()
        return base_result

    return {'hp': 0, 'cold_resist': 0}


def extract(targets: list[dict]) -> dict[str, dict]:
    """Return combat stats keyed by target key for all targets with a monster_id."""
    result: dict[str, dict] = {}
    for target in targets:
        if 'monster_id' not in target:
            continue
        stats = _get_combat_stats(
            target['monster_id'],
            target['difficulty'],
            target.get('superunique', False),
            target.get('elite', False),
        )
        if stats['hp']:
            result[target['key']] = stats
    return result

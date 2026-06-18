"""
parse_treasure_classes.py — D2R txt ingestion library

Parses raw D2R .txt files and exposes helpers used by downstream scripts.

Public API:
  resolve_tc(monster_id, difficulty) -> str
  walk_tc(tc_name) -> Generator[(item_code, probability, quality_factor)]
  get_item_ratio(item_code) -> ItemRatioRow
  get_unique_candidates(item_code, ilvl) -> list[(name, rarity)]
"""

import csv
import os
from dataclasses import dataclass
from typing import Generator

RAW_DIR = os.path.join(os.path.dirname(__file__), '..', 'data', 'raw')


def _csv_rows(filename: str) -> list[dict]:
    path = os.path.join(RAW_DIR, filename)
    with open(path, newline='', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f, delimiter='\t')
        first = reader.fieldnames[0] if reader.fieldnames else ''
        return [row for row in reader if row.get(first, '').strip()]


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class TreasureClass:
    name: str
    group: int | None
    level: int | None
    picks: int
    nodrop: int
    unique: int   # quality bonus out of 1024; higher = better unique chance
    set_: int
    rare: int
    magic: int
    items: list[tuple[str, int]]  # (item_code_or_sub_tc_name, probability_weight)


@dataclass
class MonsterInfo:
    id: str
    level: dict[str, int]   # difficulty -> mlvl
    tc: dict[str, str]      # difficulty -> base TC name (regular kill)


@dataclass
class ItemRatioRow:
    unique: int
    unique_divisor: int
    unique_min: int
    rare: int
    rare_divisor: int
    rare_min: int
    set_: int
    set_divisor: int
    set_min: int
    magic: int
    magic_divisor: int
    magic_min: int


@dataclass
class UniqueEntry:
    name: str
    qlvl: int
    rarity: int


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def _load_tc_data() -> dict[str, TreasureClass]:
    tcs: dict[str, TreasureClass] = {}
    for row in _csv_rows('treasureclassex.txt'):
        name = row['Treasure Class'].strip()
        if not name:
            continue
        items: list[tuple[str, int]] = []
        for i in range(1, 11):
            item = row.get(f'Item{i}', '').strip()
            prob_s = row.get(f'Prob{i}', '').strip()
            if item and prob_s:
                items.append((item, int(prob_s)))

        def _int(col: str) -> int:
            v = row.get(col, '').strip()
            return int(v) if v else 0

        tcs[name] = TreasureClass(
            name=name,
            group=_int('group') or None,
            level=_int('level') or None,
            picks=_int('Picks') or 1,
            nodrop=_int('NoDrop'),
            unique=_int('Unique'),
            set_=_int('Set'),
            rare=_int('Rare'),
            magic=_int('Magic'),
            items=items,
        )
    return tcs


def _build_atomic_tcs() -> dict[str, TreasureClass]:
    """Construct armoXX and weapXX TCs from armor.txt and weapons.txt.

    The game builds these at runtime by grouping spawnable items whose qlvl
    falls in [XX-2, XX], weighted by their rarity column.
    """
    armor_by_qlvl: dict[int, list[tuple[str, int]]] = {}
    weap_by_qlvl: dict[int, list[tuple[str, int]]] = {}

    for row in _csv_rows('armor.txt'):
        lvl_s = row.get('level', '').strip()
        code = row.get('code', '').strip()
        spawnable = row.get('spawnable', '0').strip()
        rarity_s = row.get('rarity', '1').strip()
        if not lvl_s or not code or spawnable != '1':
            continue
        qlvl = int(lvl_s)
        rarity = int(rarity_s) if rarity_s else 1
        armor_by_qlvl.setdefault(qlvl, []).append((code, rarity))

    for row in _csv_rows('weapons.txt'):
        lvl_s = row.get('level', '').strip()
        code = row.get('code', '').strip()
        spawnable = row.get('spawnable', '0').strip()
        rarity_s = row.get('rarity', '1').strip()
        if not lvl_s or not code or spawnable != '1':
            continue
        qlvl = int(lvl_s)
        rarity = int(rarity_s) if rarity_s else 1
        weap_by_qlvl.setdefault(qlvl, []).append((code, rarity))

    atomic: dict[str, TreasureClass] = {}
    for xx in range(3, 90, 3):
        lo = xx - 2
        for prefix, by_qlvl in (('armo', armor_by_qlvl), ('weap', weap_by_qlvl)):
            items: list[tuple[str, int]] = []
            for ql in range(lo, xx + 1):
                items.extend(by_qlvl.get(ql, []))
            if items:
                key = f'{prefix}{xx}'
                atomic[key] = TreasureClass(
                    name=key,
                    group=None, level=None,
                    picks=1, nodrop=0,
                    unique=0, set_=0, rare=0, magic=0,
                    items=items,
                )
    return atomic


def _load_monstats() -> dict[str, MonsterInfo]:
    monsters: dict[str, MonsterInfo] = {}
    for row in _csv_rows('monstats.txt'):
        mid = row.get('Id', '').strip()
        if not mid:
            continue
        level = {
            'normal': int(row.get('Level', '0') or '0'),
            'nightmare': int(row.get('Level(N)', '0') or '0'),
            'hell': int(row.get('Level(H)', '0') or '0'),
        }
        # Use the base TreasureClass column for regular (repeated) farming kills.
        # TreasureClassQuest is only for the first-ever kill with quest active.
        tc: dict[str, str] = {}
        for diff, suffix in [('normal', ''), ('nightmare', '(N)'), ('hell', '(H)')]:
            col = f'TreasureClass{suffix}' if suffix else 'TreasureClass'
            tc[diff] = row.get(col, '').strip()
        monsters[mid] = MonsterInfo(id=mid, level=level, tc=tc)
    return monsters


def _load_superuniques() -> dict[str, dict]:
    sus: dict[str, dict] = {}
    for row in _csv_rows('superuniques.txt'):
        name = row.get('Superunique', '').strip()
        if not name:
            continue
        sus[name] = {
            'class': row.get('Class', '').strip(),
            'tc': {
                'normal': row.get('TC', '').strip(),
                'nightmare': row.get('TC(N)', '').strip(),
                'hell': row.get('TC(H)', '').strip(),
            },
        }
    return sus


def _load_item_ratio() -> dict[tuple[int, int, int], ItemRatioRow]:
    rows: dict[tuple[int, int, int], ItemRatioRow] = {}
    for row in _csv_rows('itemratio.txt'):
        key = (
            int(row.get('Version', '0') or '0'),
            int(row.get('Uber', '0') or '0'),
            int(row.get('Class Specific', '0') or '0'),
        )

        def _i(col: str) -> int:
            v = row.get(col, '0') or '0'
            return int(v)

        rows[key] = ItemRatioRow(
            unique=_i('Unique'), unique_divisor=_i('UniqueDivisor'), unique_min=_i('UniqueMin'),
            rare=_i('Rare'), rare_divisor=_i('RareDivisor'), rare_min=_i('RareMin'),
            set_=_i('Set'), set_divisor=_i('SetDivisor'), set_min=_i('SetMin'),
            magic=_i('Magic'), magic_divisor=_i('MagicDivisor'), magic_min=_i('MagicMin'),
        )
    return rows


def _load_unique_items() -> dict[str, list[UniqueEntry]]:
    import json as _json
    names_path = os.path.join(RAW_DIR, 'item-names.json')
    key_to_display = {e['Key']: e['enUS'] for e in _json.loads(open(names_path, encoding='utf-8-sig').read()) if 'Key' in e and 'enUS' in e}

    by_code: dict[str, list[UniqueEntry]] = {}
    for row in _csv_rows('uniqueitems.txt'):
        index = row.get('index', '').strip()
        code = row.get('code', '').strip()
        disabled = row.get('disabled', '0').strip()
        spawnable = row.get('spawnable', '').strip()
        lvl_s = row.get('lvl', '').strip()
        rarity_s = row.get('rarity', '1').strip()
        if not code or not index or disabled == '1' or spawnable != '1':
            continue
        name = key_to_display.get(index, index)
        by_code.setdefault(code, []).append(UniqueEntry(
            name=name,
            qlvl=int(lvl_s) if lvl_s else 0,
            rarity=int(rarity_s) if rarity_s else 1,
        ))
    return by_code


def _load_set_items() -> dict[str, list[UniqueEntry]]:
    by_code: dict[str, list[UniqueEntry]] = {}
    for row in _csv_rows('setitems.txt'):
        name = row.get('index', '').strip()
        code = row.get('item', '').strip()
        disabled = row.get('disabled', '0').strip()
        lvl_s = row.get('lvl', '').strip()
        rarity_s = row.get('rarity', '1').strip()
        if not code or not name or disabled == '1':
            continue
        by_code.setdefault(code, []).append(UniqueEntry(
            name=name,
            qlvl=int(lvl_s) if lvl_s else 0,
            rarity=int(rarity_s) if rarity_s else 1,
        ))
    return by_code


def _load_class_specific_types() -> frozenset[str]:
    """Return the set of item type codes that are class-specific (have a Class field in itemtypes.txt)."""
    codes: set[str] = set()
    for row in _csv_rows('itemtypes.txt'):
        if row.get('Class', '').strip():
            code = row.get('Code', '').strip()
            if code:
                codes.add(code)
    return frozenset(codes)


def _load_item_type_map() -> dict[str, str]:
    """Return item_code -> item_type from armor.txt, weapons.txt, and misc.txt."""
    code_to_type: dict[str, str] = {}
    for fname in ('armor.txt', 'weapons.txt', 'misc.txt'):
        for row in _csv_rows(fname):
            code = row.get('code', '').strip()
            itype = row.get('type', '').strip()
            if code and itype:
                code_to_type[code] = itype
    return code_to_type


# ---------------------------------------------------------------------------
# Lazy singletons
# ---------------------------------------------------------------------------

_TC_DATA: dict[str, TreasureClass] | None = None
_MONSTATS: dict[str, MonsterInfo] | None = None
_SUPERUNIQUES: dict[str, dict] | None = None
_ITEM_RATIO: dict[tuple, ItemRatioRow] | None = None
_UNIQUE_ITEMS: dict[str, list[UniqueEntry]] | None = None
_SET_ITEMS: dict[str, list[UniqueEntry]] | None = None
_GROUP_INDEX: dict[int, list[TreasureClass]] | None = None
_CLASS_SPECIFIC_TYPES: frozenset[str] | None = None
_ITEM_TYPE_MAP: dict[str, str] | None = None


def _get_tcs() -> dict[str, TreasureClass]:
    global _TC_DATA
    if _TC_DATA is None:
        _TC_DATA = _load_tc_data()
        _TC_DATA.update(_build_atomic_tcs())
    return _TC_DATA


def _get_monstats() -> dict[str, MonsterInfo]:
    global _MONSTATS
    if _MONSTATS is None:
        _MONSTATS = _load_monstats()
    return _MONSTATS


def _get_superuniques() -> dict[str, dict]:
    global _SUPERUNIQUES
    if _SUPERUNIQUES is None:
        _SUPERUNIQUES = _load_superuniques()
    return _SUPERUNIQUES


def _get_item_ratio() -> dict[tuple, ItemRatioRow]:
    global _ITEM_RATIO
    if _ITEM_RATIO is None:
        _ITEM_RATIO = _load_item_ratio()
    return _ITEM_RATIO


def _get_unique_items() -> dict[str, list[UniqueEntry]]:
    global _UNIQUE_ITEMS
    if _UNIQUE_ITEMS is None:
        _UNIQUE_ITEMS = _load_unique_items()
    return _UNIQUE_ITEMS


def _get_set_items() -> dict[str, list[UniqueEntry]]:
    global _SET_ITEMS
    if _SET_ITEMS is None:
        _SET_ITEMS = _load_set_items()
    return _SET_ITEMS


def _get_class_specific_types() -> frozenset[str]:
    global _CLASS_SPECIFIC_TYPES
    if _CLASS_SPECIFIC_TYPES is None:
        _CLASS_SPECIFIC_TYPES = _load_class_specific_types()
    return _CLASS_SPECIFIC_TYPES


def _get_item_type_map() -> dict[str, str]:
    global _ITEM_TYPE_MAP
    if _ITEM_TYPE_MAP is None:
        _ITEM_TYPE_MAP = _load_item_type_map()
    return _ITEM_TYPE_MAP


def _get_group_index() -> dict[int, list[TreasureClass]]:
    global _GROUP_INDEX
    if _GROUP_INDEX is None:
        groups: dict[int, list[TreasureClass]] = {}
        for tc in _get_tcs().values():
            if tc.group is not None and tc.level is not None:
                groups.setdefault(tc.group, []).append(tc)
        for g in groups:
            groups[g].sort(key=lambda t: t.level)
        _GROUP_INDEX = groups
    return _GROUP_INDEX


# ---------------------------------------------------------------------------
# TC upgrade logic
# ---------------------------------------------------------------------------

def _upgrade_tc(tc_name: str, mlvl: int) -> str:
    """Apply TC group upgrade: pick the highest-level TC in the same group with level <= mlvl."""
    tcs = _get_tcs()
    tc = tcs.get(tc_name)
    if tc is None or tc.group is None or tc.level is None:
        return tc_name
    groups = _get_group_index()
    best = tc_name
    for candidate in groups.get(tc.group, []):
        if candidate.level <= mlvl:
            best = candidate.name
    return best


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def resolve_tc(monster_id: str, difficulty: str) -> str:
    """
    Return the TC name for a monster in the given difficulty after upgrade logic.

    monster_id: monstats Id (e.g. 'andariel') or superunique name (e.g. 'Pindleskin')
    difficulty: 'normal', 'nightmare', or 'hell'
    """
    superuniques = _get_superuniques()
    monstats = _get_monstats()

    if monster_id in superuniques:
        su = superuniques[monster_id]
        base_tc = su['tc'].get(difficulty, '')
        base_class = su['class']
        mon = monstats.get(base_class)
        mlvl = mon.level.get(difficulty, 0) if mon else 0
        return _upgrade_tc(base_tc, mlvl)

    mon = monstats.get(monster_id)
    if mon is None:
        raise ValueError(f'Unknown monster_id: {monster_id!r}')
    base_tc = mon.tc.get(difficulty, '')
    mlvl = mon.level.get(difficulty, 0)
    return _upgrade_tc(base_tc, mlvl)


def walk_tc(
    tc_name: str,
    _quality_factor: int = 0,
) -> Generator[tuple[str, float, int], None, None]:
    """
    Recursively walk a TC tree, yielding leaf item drops.

    Yields (item_code, probability, quality_factor) where:
      item_code      — D2R item code (e.g. 'buc', 'r24')
      probability    — expected drop count per single activation of the root TC,
                       accounting for Picks at every level
      quality_factor — max TC Unique quality bonus (out of 1024) seen along the
                       path; used in the quality-check formula in calculate_drop_odds.py
    Gold entries ('gld,...') are silently skipped.
    """
    tcs = _get_tcs()
    tc = tcs.get(tc_name)
    if tc is None:
        # Already a leaf item code
        yield (tc_name, 1.0, _quality_factor)
        return

    qf = max(_quality_factor, tc.unique)
    total_weight = tc.nodrop + sum(w for _, w in tc.items)
    if total_weight == 0:
        return

    picks = abs(tc.picks)  # picks=-1 means exactly 1 forced pick

    for item_name, weight in tc.items:
        if item_name.startswith('gld'):
            continue
        p_per_pick = weight / total_weight
        p_total = p_per_pick * picks

        if item_name in tcs:
            for sub_item, sub_p, sub_qf in walk_tc(item_name, qf):
                yield (sub_item, p_total * sub_p, sub_qf)
        else:
            yield (item_name, p_total, qf)


def get_item_ratio(item_code: str) -> ItemRatioRow:
    """Return the correct D2R quality ratio row for the given item code.

    Uses (Version=1, Uber=0, ClassSpecific=1) for class-specific items (orbs,
    pelts, heads, claws, auric shields, amazon weapons, grimoires, etc.) and
    (Version=1, Uber=0, ClassSpecific=0) for everything else.
    """
    itype = _get_item_type_map().get(item_code, '')
    class_specific = 1 if itype in _get_class_specific_types() else 0
    return _get_item_ratio()[(1, 0, class_specific)]


_GC_PREFIX_ROWS: list[dict] | None = None


def _build_type_ancestors(code: str) -> frozenset[str]:
    all_rows = {r.get('Code', '').strip(): r for r in _csv_rows('itemtypes.txt') if r.get('Code', '').strip()}
    visited: set[str] = set()
    stack = [code]
    while stack:
        c = stack.pop()
        if c in visited:
            continue
        visited.add(c)
        row = all_rows.get(c, {})
        for eq in ('Equiv1', 'Equiv2'):
            parent = row.get(eq, '').strip()
            if parent:
                stack.append(parent)
    return frozenset(visited)


def _get_gc_prefix_rows() -> list[dict]:
    """Return magicprefix rows applicable to cm3, with spawnable=1 and frequency>0."""
    global _GC_PREFIX_ROWS
    if _GC_PREFIX_ROWS is not None:
        return _GC_PREFIX_ROWS

    gc_itype = _get_item_type_map().get('cm3', '')
    gc_ancestors = _build_type_ancestors(gc_itype)

    result = []
    for row in _csv_rows('magicprefix.txt'):
        if row.get('spawnable', '').strip() != '1':
            continue
        freq_s = row.get('frequency', '').strip()
        freq = int(freq_s) if freq_s else 0
        if freq <= 0:
            continue
        itypes = {row.get(f'itype{i}', '').strip() for i in range(1, 8)} - {''}
        etypes = {row.get(f'etype{i}', '').strip() for i in range(1, 6)} - {''}
        if not itypes.intersection(gc_ancestors):
            continue
        if etypes.intersection(gc_ancestors):
            continue
        result.append(row)
    _GC_PREFIX_ROWS = result
    return result


def get_skiller_gc_fraction(ilvl: int) -> float:
    """Return fraction of magic GC prefixes that are class skill tree prefixes at the given ilvl (all 8 classes)."""
    total_weight = skiller_weight = 0
    for row in _get_gc_prefix_rows():
        lvl = int(row.get('level', '0') or '0')
        maxlvl = int(row.get('maxlevel', '0') or '0')
        if ilvl < lvl:
            continue
        if maxlvl and ilvl > maxlvl:
            continue
        freq = int(row.get('frequency', '0') or '0')
        total_weight += freq
        if row.get('mod1code', '').strip() == 'skilltab':
            skiller_weight += freq
    return skiller_weight / total_weight if total_weight > 0 else 0.0


_monlvl_cache: dict[int, dict[str, int]] | None = None


def _get_monlvl() -> dict[int, dict[str, int]]:
    """Return monlvl lookup: {level: {'HP': ..., 'HP(N)': ..., 'HP(H)': ..., 'L-HP': ..., 'L-HP(N)': ..., 'L-HP(H)': ...}}."""
    global _monlvl_cache
    if _monlvl_cache is None:
        _monlvl_cache = {}
        for row in _csv_rows('monlvl.txt'):
            try:
                lvl = int(row['Level'])
            except (KeyError, ValueError):
                continue
            _monlvl_cache[lvl] = {k: int(v) for k, v in row.items() if v.strip().lstrip('-').isdigit()}
    return _monlvl_cache


def get_monster_combat_stats(monster_id: str, difficulty: str = 'hell') -> dict:
    """Return HP and cold resistance for a monster at the given difficulty.

    HP formula: avg(minHP, maxHP) * L-HP(difficulty)[monster_level] / 100
    Uses the L-HP column from monlvl.txt, which applies to boss/named monsters.
    """
    suffix = {'normal': '', 'nightmare': '(N)', 'hell': '(H)'}[difficulty]
    lhp_col = {'normal': 'L-HP', 'nightmare': 'L-HP(N)', 'hell': 'L-HP(H)'}[difficulty]
    lvl_col = {'normal': 'Level', 'nightmare': 'Level(N)', 'hell': 'Level(H)'}[difficulty]

    def _ri(row: dict, col: str) -> int:
        v = row.get(col, '') or ''
        try:
            return int(v.strip())
        except ValueError:
            return 0

    monlvl = _get_monlvl()

    for row in _csv_rows('monstats.txt'):
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


def get_unique_candidates(item_code: str, ilvl: int) -> list[tuple[str, int]]:
    """
    Return (name, rarity) for all unique and set items of this base type with qlvl <= ilvl.

    Used to compute specific-unique selection weight:
      P(this unique) = rarity / sum(all eligible rarities)
    """
    candidates: list[tuple[str, int]] = []
    for entry in _get_unique_items().get(item_code, []):
        if entry.qlvl <= ilvl:
            candidates.append((entry.name, entry.rarity))
    for entry in _get_set_items().get(item_code, []):
        if entry.qlvl <= ilvl:
            candidates.append((entry.name, entry.rarity))
    return candidates

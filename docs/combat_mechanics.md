# D2R Combat Mechanics Reference

This document captures combat-relevant mechanics and their data sources.
It reflects current understanding and is updated as more is learned.
Where a value is an engine constant not found in any data file, that is noted explicitly.

---

## Elite Monster Types

Three categories of elite monsters exist, each with different modifier counts and HP scaling.

### Random Unique Monsters

- **Hell: 3 random modifiers**, drawn without replacement from the unique modifier pool
- HP: base × 2.0 on Hell (+100% bonus)
- Minions: base × 1.5 on Hell (+50% bonus)

*Sources: `data/raw/monumod.txt` (modifier pool and weights), maxroll.gg/d2/resources/elite-monster (modifier counts and HP multipliers)*

### Super-Unique Monsters

- **Preset modifiers** defined in `data/raw/superuniques.txt` (Mod1, Mod2, Mod3 columns, decoded via `monumod.txt` id column)
- **Hell: +2 additional random modifiers** drawn from the same pool as random uniques
- HP: base × 2.0 on Hell (same as random uniques)
- Minions: base × 1.5 on Hell

The "hidden affix" mentioned in community resources refers to the preset mods from superuniques.txt.

*Sources: `data/raw/superuniques.txt`, `data/raw/monumod.txt`, maxroll.gg/d2/resources/elite-monster*

### Champions

- **1 champion state** drawn from the champion pool (`champion=1` column in `monumod.txt`)
- Champion pool and weights: `cpick(H)` column in `monumod.txt`
- HP multiplier varies by champion state (Hell):

| State      | HP multiplier |
|------------|---------------|
| Berserker  | 0.5×          |
| Fanatic    | 2.0×          |
| Ghostly    | 2.0×          |
| Possessed  | 4.0×          |
| (standard) | 2.0×          |

*Sources: `data/raw/monumod.txt`, maxroll.gg/d2/resources/elite-monster*

---

## Random Modifier Pool (Hell)

From `monumod.txt`, the 13 modifiers eligible for random unique selection on Hell (`upick(H) > 0`),
all with equal weight (6):

| id | uniquemod   |
|----|-------------|
|  5 | strong      |
|  6 | fast        |
|  7 | curse       |
|  8 | resist      |
|  9 | fire        |
| 17 | lightning   |
| 18 | cold        |
| 25 | manahit     |
| 26 | teleport    |
| 27 | spectralhit |
| 28 | stoneskin   |
| 29 | multishot   |
| 30 | aura        |

Note: `resist` is not available on Normal difficulty (`upick` is empty for normal).

---

## Modifiers Relevant to Cold Immunity

### Cold Enchanted (`cold`, id=18)

- Adds **+75 cold resistance** to the boss
- Also adds cold damage to attacks (formula: min = mLvl × 66/100, max = mLvl)
- Also adds cold damage to minions at half values in Nightmare/Hell
- On boss death: releases a frost nova at skill level = mLvl / 2
- Minions inherit this mod because `xfer=1` in `monumod.txt`

For any monster with base cold resist ≥ 25: rolling `cold` pushes cold resist to ≥ 100 → **cold immune**.

**The +75 cold resistance value is an engine constant — not present in any data file.**

*Source: maxroll.gg/d2/resources/elite-monster*

### Magic Resistant (`resist`, id=8)

- Adds **+40** to each elemental resistance individually, only where current resist < 100%
- Will not grant a **third immunity** (stops applying if doing so would exceed 2 total immunities)

For council members (base cold resist 33): rolling `resist` raises cold to 73 — **not cold immune**.
A second `resist` roll is impossible since mods are drawn without replacement.

**The +40 per element value and the 3-immunity cap are engine constants — not present in any data file.**

*Source: maxroll.gg/d2/resources/elite-monster*

---

## Cold Immunity Probability

A monster becomes cold immune if its effective cold resistance ≥ 100.

### Derivation

- Base cold resist: `ResCo(H)` from `monstats.txt` + any `extra-cold` entries in `monprop.txt`
- Only `cold` mod (id=18) adds enough (+75) to push a typical monster to immunity
- `resist` mod (+40) is insufficient for council (base 33 + 40 = 73 < 100); would only matter
  for monsters with base cold resist ≥ 60

### Probability formula (no duplicates, equal weights)

Given a pool of **P = 13** eligible mods and **N** random picks without replacement:

```
P(cold immune) = N / P    (simplified from the full product since all weights are equal)
```

| Monster type       | N | P(cold immune)   |
|--------------------|---|------------------|
| Hell super-unique  | 2 | 2/13 ≈ **15.4%** |
| Hell random unique | 3 | 3/13 ≈ **23.1%** |

This applies to any monster where base cold resist + 75 ≥ 100 (i.e., base ≥ 25).
Monsters with base cold resist ≥ 100 are always cold immune regardless of mods.

### Cold Sunder interaction

If the player carries a cold sunder charm, cold immunity is broken (effective cold resist
becomes capped at a high but finite value). The engine should skip the cold immunity check
entirely and proceed to the kill calculation with sunder-adjusted resist.

---

## Base HP Calculation

Monster actual HP on Hell is derived from two files:

1. **`monstats.txt`**: `MinHP(H)` and `MaxHP(H)` — base HP range before level scaling
2. **`monlvl.txt`**: `HP(H)` column at the monster's `Level(H)` — a multiplier (divide by 100)

```
actual_hp = avg(MinHP(H), MaxHP(H)) × monlvl[Level(H)].HP(H) / 100
```

Apply the elite HP multiplier (2.0× for unique boss, 1.5× for minions) on top of this.

*Sources: `data/raw/monstats.txt`, `data/raw/monlvl.txt`*

---

## Travincal Council

### Super-unique zone assignment

Travincal has 3 super-uniques (hcIdx 26–28 in `superuniques.txt`).
The adjacent 3 (hcIdx 29–31: Toorc, Wyand, Maffer) are in Durance of Hate Level 3.
**This zone assignment is encoded in binary DS1 map files** (see `lvlprest.txt` entries
for `Act 3 - Travincal NW/N/NE/SW/S/SE`, each pointing to e.g. `Act3/Travincal/TravNW.ds1`)
and cannot be derived from any txt data file. The 3 Trav super-uniques are hardcoded in
`build_db.py` with a comment referencing this.

| Super-unique      | Base class     | Fixed mods (from superuniques.txt + monumod.txt) | Minions (MaxGrp) |
|-------------------|----------------|--------------------------------------------------|------------------|
| Ismail Vilehand   | councilmember1 | fast (id=6), curse (id=7)                        | 2                |
| Geleb Flamefinger | councilmember2 | strong (id=5), fire (id=9)                       | 2                |
| Bremm Sparkfist   | councilmember3 | aura (id=30), lightning (id=17)                  | 2                |

Total from super-unique data: 3 super-uniques + 6 minions = **9 council members**.
Online sources cite ~11 total; the remaining ~2 appear to be preset spawns baked into the
DS1 binary map tiles, not derivable from txt data.

### Base stats (Hell, all council member types)

| Stat         | councilmember1        | councilmember2        | councilmember3        |
|--------------|-----------------------|-----------------------|-----------------------|
| Level(H)     | 88                    | 88                    | 88                    |
| Avg base HP  | 275 (MinHP=200, MaxHP=350) | ← same           | ← same                |
| Scaled HP    | 275 × 4895 / 100 ≈ **13,461** | ← same       | ← same                |
| ResCo(H)     | 33%                   | 33%                   | 33%                   |
| ResFi(H)     | 120% (**fire immune**) | 33%                  | 33%                   |
| ResLi(H)     | 33%                   | 100% (**light immune**) | 100% (**light immune**) |
| monprop (H)  | extra-fire +100       | extra-fire +100       | extra-fire +100       |

*Sources: `data/raw/monstats.txt`, `data/raw/monlvl.txt`, `data/raw/monprop.txt`,
`data/raw/superuniques.txt`, `data/raw/monumod.txt`*

### Cold immunity for Trav council

None of the three Trav super-uniques have `cold` (id=18) as a fixed mod.
All three can randomly roll it as one of their 2 Hell random mods:

- **P(cold immune) ≈ 15.4%** per super-unique (2/13)
- If a super-unique rolls cold, its 2 minions are also cold immune (`xfer=1` on `cold` mod
  in `monumod.txt`)

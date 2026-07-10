# Gear Data Reference

This document captures gear/item stat values that aren't a direct single-column
read from a raw txt file, plus their derivation.

---

## Sunder Charms — random bonus stat

Sunder Charms (`Cold Rupture`, `Rotting Fissure`, etc.) are Grand-sized charms
(`cm3` in `data/raw/misc.txt`) granting a fixed immunity-pierce + resistance
penalty, plus one random bonus stat chosen from a small pool.

The crafted variant (e.g. `Crafted Cold Rupture` in `data/raw/uniqueitems.txt`)
lists six `Gelid-AffixN` property-group references (prop5–prop9 columns). Each
`Gelid-AffixN` group is defined in `data/raw/propertygroups.txt`, where the
group lists 1-2 candidate stats with independent min/max rolls and equal pick
weight (`PickMode 2`).

`Gelid-Affix2` is the group relevant to Magic Find:

| Stat   | Roll range |
|--------|------------|
| `mag%` (Magic Find) | 14–25% |
| `gold%` (Gold Find)  | 20–55% |

So the max roll for the Magic-Find outcome on a Sunder Charm is **25%**, not the
7% small-charm "of Good Luck" cap. `data/items_config.json`'s `custom_charms`
entry `"Cold Rupture (MF)"` models the max-MF-roll variant and is set to `25`
accordingly.

*Sources: `data/raw/uniqueitems.txt` (`Crafted Cold Rupture` row, prop6 =
`Gelid-Affix2`), `data/raw/propertygroups.txt` (`Gelid-Affix2` row, mod1max).*

---

## Charm inventory size

Each charm occupies 1, 2, or 3 inventory tiles depending on its base type. This is
read directly from `data/raw/misc.txt`'s `invwidth` × `invheight` columns for the
charm base codes:

| Code | Base item | Tiles | Size |
|------|-----------|-------|------|
| `cm1` | Small Charm | 1×1 = 1 | small |
| `cm2` | Large Charm | 1×2 = 2 | large |
| `cm3` | Grand Charm | 1×3 = 3 | grand |
| `cs2` | Crafted Sunder Charm | 1×3 = 3 | grand |

`unique_charms` entries (`data/items_config.json`) look this up automatically via
their `code` column in `data/raw/uniqueitems.txt`. `custom_charms` entries are
theoretical/homebrew charms with no `uniqueitems.txt` row, so each one must declare
which base charm shape it represents via a required `"code"` field:

- `Sorc Torch` → `cm2` (modeled on `Hellfire Torch`, which is a Large Charm)
- `+1 Cold Sorc Skiller` → `cm3` (class-skill "of Skill" charms only roll on Grand
  Charms in D2R — this affix does not appear on small/large charms)
- `Cold Rupture (MF)` → `cs2` (modeled on `Crafted Cold Rupture`)
- `7% MF SC` → `cm1` ("SC" = Small Charm)

*Source for the extraction logic: `data/raw/misc.txt` (`invwidth`/`invheight` columns
for codes `cm1`/`cm2`/`cm3`/`cs2`). The charm-code-to-shape assignment for individual
custom/theoretical charms above is manual curation (there is no data file describing
what a homebrew charm "is"), cross-checked against maxroll.gg/d2/resources and common
community knowledge of which charm affixes roll on which charm size.*

### Inventory capacity model (charm picker + Potential Upgrades charm suggestions)

Both the charm picker (`CharmsPanel`, disables/caps picks that wouldn't fit) and the
"Potential Upgrades" panel (`potentialUpgrades` computed, only suggests a charm if
there's room for it) share one capacity model, in `public/js/app.js`
(`CHARM_COLUMN_HEIGHTS`, `packCharmColumns`, `placeInColumns`). It is not derived
from data — it's a deliberate approximation, not exact D2R bin packing:

- Charms are always 1 tile wide, so packing reduces to independent 1-D bins
  (columns) rather than full 2-D bin packing.
- Usable charm space is modeled as 8 columns of height 4, plus one extra column of
  height 2 — 34 tiles total. The full inventory reserves a block for the Horadric
  Cube (2×2) and a Tome of Town Portal (1×2); a Tome of Identify is assumed *not*
  carried (portal-only loadout), which frees up the extra 1×2 column.
- Given the current charms, columns are packed largest-first (grand, then large,
  then small) via best-fit (place into the tightest column that still fits), so a
  large charm can't consume space a grand charm still needs. "Is there room for one
  more of size X" is then just: does any resulting column have ≥X remaining height.
  This correctly reflects that a large or grand charm already in a column can block
  future large/grand charms from fitting there — something a single shared "tile
  budget" number can't represent — while small charms (1×1) can still drop into any
  leftover 1-tile gap regardless of column contents.

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

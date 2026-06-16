# Milestone 2: Core UI & State Sync

Stack: Vue 3 via CDN (ES module imports), Tailwind CSS via CDN, zero build.
All frontend files go under `public/`. Served by GitHub Pages or any static host.

---

## Commit 2: `public/index.html` + `public/css/theme.css` — D2-themed scaffold

`index.html`:
- Vue 3 CDN (`esm-browser` build, latest stable)
- Tailwind CSS CDN play script
- `<link rel="stylesheet" href="css/theme.css">`
- `<div id="app"></div>` mount point
- `<script type="module" src="js/app.js"></script>`

`theme.css` — CSS custom properties for D2 palette:
- `--color-unique: #C7B377`
- `--color-set: #00FF00`
- `--color-magic: #4850B8`
- `--color-rune: #FFA800`
- `--color-bg: #0d0e11`
- `--color-surface: #1a1c23`
- `--color-border: #2e3140`

Base `body` styles: dark background, system-ui font stack with "Times New Roman" for flavor.

---

## Commit 3: `public/js/gear-db.js` — preset item database

Exports:

**`GEAR_SLOTS`** — ordered array `{ id, label }`:
head, amulet, weapon, shield, armor, gloves, belt, boots, ring1, ring2, charms

**`PRESET_ITEMS`** — object keyed by slot id; each entry is an array of
`{ id, name, fcr, mf, allSkills, coldSkills, notes }`. Use typical/common roll values.

| Slot | id | name | FCR | MF | +All | +Cold |
|---|---|---|---|---|---|---|
| head | shako | Harlequin Crest | 0 | 70 | 2 | 0 |
| head | griffons | Griffon's Eye | 25 | 0 | 1 | 0 |
| head | lore | Lore (runeword) | 0 | 0 | 1 | 0 |
| amulet | maras | Mara's Kaleidoscope | 0 | 0 | 2 | 0 |
| amulet | eye_of_etlich | The Eye of Etlich | 0 | 20 | 1 | 0 |
| weapon | oculus | The Oculus | 20 | 50 | 3 | 3 |
| weapon | hoto | Heart of the Oak | 40 | 0 | 3 | 0 |
| weapon | wizardspike | Wizardspike | 50 | 0 | 0 | 0 |
| weapon | eschuta | Eschuta's Temper | 20 | 0 | 0 | 3 |
| shield | spirit | Spirit (monarch) | 35 | 0 | 2 | 0 |
| shield | lidless | Lidless Wall | 20 | 0 | 1 | 0 |
| armor | vipermagi | Skin of the Vipermagi | 30 | 30 | 1 | 0 |
| armor | enigma | Enigma (runeword) | 0 | 45 | 2 | 0 |
| armor | wealth | Wealth (runeword) | 0 | 100 | 0 | 0 |
| gloves | magefist | Magefist | 20 | 0 | 0 | 1 |
| gloves | trang_claws | Trang-Oul's Claws | 20 | 0 | 0 | 0 |
| belt | arachnid | Arachnid Mesh | 20 | 0 | 1 | 0 |
| belt | goldwrap | Goldwrap | 0 | 65 | 0 | 0 |
| belt | tal_belt | Tal Rasha's Fine-Spun Cloth | 20 | 0 | 0 | 0 |
| boots | war_traveler | War Traveler | 0 | 45 | 0 | 0 |
| boots | silkweave | Silkweave | 0 | 30 | 0 | 0 |
| boots | waterwalk | Waterwalk | 0 | 15 | 0 | 0 |
| ring1/ring2 | soj | Stone of Jordan | 0 | 40 | 1 | 0 |
| ring1/ring2 | nagel | Nagelring | 0 | 25 | 0 | 0 |
| ring1/ring2 | rare_fcr | Rare FCR Ring | 10 | 0 | 0 | 0 |
| charms | (custom only) | | | | | |

Each slot also gets an implicit `{ id: 'custom', name: 'Custom / Other' }` entry
that activates free-form numeric inputs.

---

## Commit 4: `public/js/app.js` — reactive state + URL sync

Uses Vue 3 `createApp` + `reactive` + `computed` + `watch`.

**State schema:**
```js
{
  gear: {
    // one entry per slot id; same shape for all 11 slots
    head: { preset: null, custom: { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 } },
    ...
  },
  coldMasteryBase: 20,   // skill points invested (0–20)
  run: {
    // keys come from run_config.json after fetch; only available runs are togglable
    bosses: {},
    overheadSecs: 30
  }
}
```

**Computed stats:**
- `totalFCR`, `totalMF`, `totalAllSkills`, `totalColdSkills` — sums across all slots
- `effectiveColdMastery` = `coldMasteryBase + totalAllSkills + totalColdSkills`
- `fcrBreakpoint` — lookup against standard Sorceress table:
  ```js
  // { minFCR: 200, frames: 7 }, { minFCR: 105, frames: 8 }, { minFCR: 63, frames: 9 },
  // { minFCR: 37, frames: 10 }, { minFCR: 20, frames: 11 }, { minFCR: 9, frames: 12 },
  // { minFCR: 0, frames: 13 }
  ```

**URL sync:**
- `encodeState(state)` → compact object (omit nulls/defaults) → JSON → `btoa` → `?s=<base64>`
- `decodeState(b64)` → `atob` → JSON → deep-merge into reactive state
- On mount: if `?s=` present, hydrate state
- `watch(state, ..., { deep: true })` → `history.replaceState` on every change

---

## Commit 5: `public/js/app.js` — GearSlot component

`GearSlot` Vue component (inline, `defineComponent` + template string).

Props: `slotId`, `slotLabel`, `presets`, `modelValue` (the slot state object).

Template:
- `<select>` listing presets + "Custom / Other"
- When `preset === 'custom'`: mini-form with inputs for Name (text), FCR, MF, +All Skills, +Cold Skills
- Emits `update:modelValue` for v-model support
- Small color-coded stat pills showing this slot's FCR/MF contribution

Gear panel layout (added to root template):
- 2-column grid: left = gear slots (grouped Head–Armor | Gloves–Charms), right = stat summary placeholder

---

## Commit 6: `public/js/app.js` — RunRoutine + StatSummary panels; full layout

**RunRoutine panel:**
- Fetches `data/run_config.json` on mount
- Renders one checkbox per run entry; `available: false` → disabled + "(coming soon)" badge
- `<input type="number">` for travel/overhead seconds

**StatSummary panel:**
- Total FCR + breakpoint badge (green if at a breakpoint, amber if within 5 FCR of next)
- Total MF (raw), +All Skills, +Cold Skills
- Effective Cold Mastery level
- `<input type="number">` for Cold Mastery base skill points (0–20)

**Full layout:**
- Sticky header: "D2R Blizzard Sorc — ETTVD Optimizer" in `--color-unique` gold
- Two-column grid: [Gear inputs] | [Run Routine + Stat Summary]
- Footer placeholder: "ETTVD: — (coming soon)" grayed out

---

## Verification

1. `python -m http.server 8080 --directory public` then open `http://localhost:8080`
2. Run routine: Andy checkbox enabled; all others grayed + "(coming soon)"
3. Select gear presets → FCR/MF/skills totals update instantly
4. URL `?s=` param updates on every change
5. Copy URL, open in new tab → state restores exactly
6. Select "Custom / Other", enter FCR=30 → total FCR updates
7. Toggle Andy → URL changes; reload → Andy remains checked

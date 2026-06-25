// UNRELEASED: add entries here while developing. Must be empty before running gh-deploy.sh.
export const UNRELEASED = [
  'Cow Level run added — models regular and champion cow packs plus the Cow King, with one-time leg-quest setup time and in-level teleports tracked separately from travel',
  'Added a Share button that copies your build/settings link to the clipboard, with a "Saved." flash whenever changes are autosaved',
  'Fixed Cold Rupture (MF) charm: Magic Find now correctly shows 25% (was 7%) for its max roll',
];

// RELEASES: most recent first. Each entry is one deploy.
export const RELEASES = [
  {
    date: '2026-06-24',
    changes: [
      'Added Travincal (Council) as an available run',
      'Meph run: added optional kill of Durance of Hate Level 3 council (toggle per run)',
      'Andy run: added elite room pack kills',
      'App settings now persist across page reloads (no URL needed)',
      'Drop breakdown now shows minion pack drops individually',
      'Fixed pack kill time (was incorrectly summing HP across pack members; now uses max)',
    ],
  },
  {
    date: '2026-06-23',
    changes: [
      'Added Meph (Durance of Hate Level 3) and Pindle as available runs',
    ],
  },
  {
    date: '2026-06-22',
    changes: [
      'Blizzard DPS now uses the exact D2R skill damage formula from game data',
      'Share URLs are now compressed (shorter links); old links auto-upgrade',
    ],
  },
  {
    date: '2026-06-21',
    changes: [
      'Sunder charms now show their type in the Stats section',
      'Added custom socket item support; unique item names auto-detected from presets',
    ],
  },
  {
    date: '2026-06-20',
    changes: [
      'Gear and charm dropdowns are now sorted alphabetically',
      'Run Routine now groups bosses by Act',
      'Valuable item minimum tier raised to Medium (fewer but more meaningful items in ETTVD)',
    ],
  },
  {
    date: '2026-06-19',
    changes: [
      'Enemy Cold Resist -%X stat now reduces monster cold resistance and affects kill time',
      '+% Cold Skill Damage stat now scales Blizzard DPS',
      'Added socket item support (runes, jewels) for gear slots',
      'Charms now support quantity input (for multiple identical charms)',
      'Added "Start from…" preset basis picker for custom charms',
      'Added Target Gear section: projected ETTVD and run time for your target build',
      'Standard, Magic Find, and Set Build presets now include charms',
    ],
  },
  {
    date: '2026-06-18',
    changes: [
      'Tal Rasha\'s and Trang-Oul\'s set items added with full set bonus tracking',
      'Spirit and Heart of the Oak runewords added (stats extracted from game data)',
      'Run Routine now shows total time with kill, travel, and overhead breakdown',
      'Corrected several item stats using raw game data',
    ],
  },
  {
    date: '2026-06-17',
    changes: [
      'Combat engine: travel time, DPS, and time-to-kill per boss with full breakdown',
      'Boss HP calculated using game-accurate level scaling',
      'Drop odds panel with per-boss breakdown and ETTVD calculator',
      'Latent Sunder Charms added to the valuable drop pool',
      'Responsive layout for mobile devices',
    ],
  },
  {
    date: '2026-06-15',
    changes: [
      'Initial launch: gear panel with item presets, drop odds from game data, ETTVD calculator',
    ],
  },
];

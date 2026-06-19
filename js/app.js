import { createApp, defineComponent, reactive, computed, watch, ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';
import { GEAR_SLOTS } from './gear-db.js';

// ── Constants ──────────────────────────────────────────────────────────────

const FCR_BREAKPOINTS = [
  { minFCR: 200, frames: 7 },
  { minFCR: 105, frames: 8 },
  { minFCR: 63,  frames: 9 },
  { minFCR: 37,  frames: 10 },
  { minFCR: 20,  frames: 11 },
  { minFCR: 9,   frames: 12 },
  { minFCR: 0,   frames: 13 },
];

const BLIZZARD_COOLDOWN_SECS = 1.8;
const ICE_BLAST_HIT_RATE     = 0.80;
const D2_FPS                 = 25;
const BLIZZARD_BOLTS_VS_BOSS = 4;
const BLIZZARD_HARD_PTS      = 20;
const ICE_BLAST_HARD_PTS     = 20;

const DEFAULT_BOSSES = { andy: true };

const CUSTOM_ITEM  = { id: 'custom', name: 'Custom / Other', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
const CUSTOM_CHARM = { id: 'custom', name: 'Custom / Other', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0, unique: false };

const PRESET_ITEMS = ref({});
const TARGET_GEAR_PRESETS = ref([]);
const SET_LEVEL_BONUSES = ref({});
const SET_SIZES = ref({});

// ── Pure computation functions ─────────────────────────────────────────────
// No Vue dependency — the optimizer can call these directly.

export function effUniqueMF(rawMF) { return rawMF === 0 ? 0 : (rawMF * 250) / (rawMF + 250); }
export function effSetMF(rawMF)    { return rawMF === 0 ? 0 : (rawMF * 500) / (rawMF + 500); }

function qualityCheckProb(qp, mlvl, effMF) {
  const baseQc = Math.floor((qp.base_chance - Math.floor(mlvl / qp.divisor)) * 1024 / qp.quality_factor) + qp.base_chance;
  const qc = Math.min(Math.floor(baseQc * 100 / (100 + effMF)), qp.min_chance);
  return 1 / qc;
}

function blizzDmgFormula(slvl)    { return BLIZZARD_BOLTS_VS_BOSS * (20 * slvl + 10); }
function iceBlastDmgFormula(slvl) { return 10 * slvl + 10; }
function iceBlastsPerWindow(framesPerCast) {
  return (Math.floor(BLIZZARD_COOLDOWN_SECS / (framesPerCast / D2_FPS)) - 1) * ICE_BLAST_HIT_RATE;
}
function cmResistReduction(cmLevel) { return 15 + 5 * cmLevel; }
function coldDmgMultiplier(monsterColdResist, cmLevel) {
  return (100 - Math.max(-100, monsterColdResist - cmResistReduction(cmLevel))) / 100;
}

export function computeFcrBreakpoint(fcr) {
  return FCR_BREAKPOINTS.find(bp => fcr >= bp.minFCR) ?? FCR_BREAKPOINTS[FCR_BREAKPOINTS.length - 1];
}

function computeFcrTooltip(fcr) {
  const idx = FCR_BREAKPOINTS.findIndex(bp => fcr >= bp.minFCR);
  const cur = FCR_BREAKPOINTS[idx];
  const excess = fcr - cur.minFCR;
  let tip = `${cur.frames} frames per cast`;
  tip += excess === 0 ? ` · exactly at breakpoint (${cur.minFCR}% FCR)` : ` · ${excess}% FCR above breakpoint (${cur.minFCR}% needed)`;
  if (idx > 0) {
    const next = FCR_BREAKPOINTS[idx - 1];
    tip += ` · next breakpoint: ${next.minFCR}% FCR for ${next.frames}f (+${next.minFCR - fcr} needed)`;
  } else {
    tip += ' · maximum breakpoint reached';
  }
  return tip;
}

function computeFcrBadgeClass(fcr) {
  const idx = FCR_BREAKPOINTS.findIndex(bp => fcr >= bp.minFCR);
  if (idx > 0 && fcr >= FCR_BREAKPOINTS[idx - 1].minFCR - 5) return 'badge-amber';
  if (FCR_BREAKPOINTS.some(bp => bp.minFCR === fcr)) return 'badge-green';
  return 'badge-default';
}

export function computeGearTotals(getSlotStats) {
  const t = { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
  for (const { id } of GEAR_SLOTS) {
    const s = getSlotStats(id);
    t.fcr        += s.fcr        || 0;
    t.mf         += s.mf         || 0;
    t.allSkills  += s.allSkills  || 0;
    t.coldSkills += s.coldSkills || 0;
  }
  return t;
}

export function computeCombat(totals, effCM) {
  const bp        = computeFcrBreakpoint(totals.fcr);
  const blizzSlvl = BLIZZARD_HARD_PTS + totals.allSkills + totals.coldSkills;
  const ibSlvl    = ICE_BLAST_HARD_PTS + totals.allSkills + totals.coldSkills;
  const ibs       = iceBlastsPerWindow(bp.frames);
  const blizzDmg  = blizzDmgFormula(blizzSlvl);
  const ibDmg     = iceBlastDmgFormula(ibSlvl);
  const blizzDps  = blizzDmg / BLIZZARD_COOLDOWN_SECS;
  const ibDps     = ibs * ibDmg / BLIZZARD_COOLDOWN_SECS;
  return { effCM, bp, blizzDps, iceBlastDps: ibDps, totalDps: blizzDps + ibDps, blizzDmg, ibDmg, ibs };
}

function computeCombatAssumptions(combat) {
  const { bp, ibs } = combat;
  return [
    `Blizzard: 1 cast / ${BLIZZARD_COOLDOWN_SECS}s cooldown, ~${BLIZZARD_BOLTS_VS_BOSS} bolts hitting boss per cast`,
    `Ice Blast: ${ibs.toFixed(1)} effective casts per window at ${ICE_BLAST_HIT_RATE * 100}% hit rate (${bp.frames} frames/cast)`,
    `Skill levels assume ${BLIZZARD_HARD_PTS} hard points in each spell; scale with +All/+Cold Skills from gear`,
    `Boss HP = avg(minHP, maxHP) × L-HP[level] ÷ 100 (from monlvl.txt)`,
    `Damage values are approximate`,
  ].join('\n');
}

function fmtMonsterId(id) {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function computeRunStats(combat, runConfigData, monsterDbData, runBosses) {
  const { bp, effCM, blizzDmg, ibDmg, ibs } = combat;
  const stats = {};
  for (const run of runConfigData) {
    if (!run.available) continue;
    const travelSecs = (run.teleports ?? 0) * bp.frames / D2_FPS;
    let killSecs = 0;
    const monCombat = monsterDbData?.monsters?.[run.id]?.combat ?? {};

    if (runBosses[run.id] && monCombat.hp) {
      const mult   = coldDmgMultiplier(monCombat.cold_resist ?? 0, effCM);
      const effDps = (blizzDmg / BLIZZARD_COOLDOWN_SECS + ibs * ibDmg / BLIZZARD_COOLDOWN_SECS) * mult;
      const amount = (run.monsters ?? []).reduce((s, m) => s + (m.amount ?? 1), 0) || 1;
      killSecs = (monCombat.hp / effDps) * amount;
    }

    const travelDetail = `~${run.teleports ?? 0} teleports × ${bp.frames} frames/cast ÷ ${D2_FPS} FPS = ${travelSecs.toFixed(1)}s`;

    let killDetail = null;
    if (monCombat.hp) {
      const monResist = monCombat.cold_resist ?? 0;
      const cmRed     = cmResistReduction(effCM);
      const effRes    = Math.max(-100, monResist - cmRed);
      const mult      = coldDmgMultiplier(monResist, effCM);
      killDetail = [
        `HP: ${monCombat.hp.toLocaleString()}`,
        `Cold resist: ${monResist}% − Cold Mastery lv ${effCM} (−${cmRed}%) → eff. resist: ${effRes}% → ${mult.toFixed(2)}× damage multiplier`,
      ].join('\n');
    }

    const monsterLines = (run.monsters ?? []).map(m =>
      `${fmtMonsterId(m.monster_id ?? m.id)} ×${m.amount ?? 1}`
    );
    const assumptions = [
      `~${run.teleports ?? 0} teleports to reach`,
      monsterLines.length ? `Kills: ${monsterLines.join(', ')}` : null,
    ].filter(Boolean).join('\n');

    stats[run.id] = { travelSecs, killSecs, totalSecs: travelSecs + killSecs,
      hasKillData: killSecs > 0, assumptions, travelDetail, killDetail };
  }
  return stats;
}

export function computeRunDropProbs(mf, runConfigData, monsterDbData, runBosses, valuableSet) {
  const uMF = effUniqueMF(mf);
  const sMF = effSetMF(mf);
  const result = {};
  for (const run of runConfigData) {
    if (!run.available || !runBosses[run.id]) continue;
    const mon = monsterDbData.monsters[run.id];
    if (!mon) continue;

    let noValuableItem = 1;
    for (const [name, item] of Object.entries(mon.drops)) {
      if (!valuableSet.has(name)) continue;
      const qp  = item.quality_params;
      const mfV = qp.quality_type === 'set' ? sMF : uMF;
      const prob = item.base_prob * qualityCheckProb(qp, mon.mlvl, mfV) * (item.unique_weight / item.unique_total_weight);
      noValuableItem *= (1 - prob);
    }
    const itemProb       = 1 - noValuableItem;
    const runeProb       = mon.good_rune_prob ?? 0;
    const skillerProb    = (mon.gc_base_prob ?? 0) * (mon.gc_skiller_frac ?? 0);
    const valuableScProb = (mon.sc_base_prob ?? 0) * (mon.sc_valuable_frac ?? 0);
    result[run.id] = { itemProb, runeProb, skillerProb, valuableScProb,
      total: 1 - (1 - itemProb) * (1 - runeProb) * (1 - skillerProb) * (1 - valuableScProb) };
  }
  return result;
}

export function aggregateDropProbs(perBossProbs) {
  const runs = Object.values(perBossProbs);
  if (!runs.length) return null;
  const agg = { itemProb: 1, runeProb: 1, skillerProb: 1, valuableScProb: 1, total: 1 };
  for (const r of runs) {
    agg.itemProb       *= (1 - r.itemProb);
    agg.runeProb       *= (1 - r.runeProb);
    agg.skillerProb    *= (1 - r.skillerProb);
    agg.valuableScProb *= (1 - r.valuableScProb);
    agg.total          *= (1 - r.total);
  }
  return {
    itemProb:       1 - agg.itemProb,
    runeProb:       1 - agg.runeProb,
    skillerProb:    1 - agg.skillerProb,
    valuableScProb: 1 - agg.valuableScProb,
    total:          1 - agg.total,
  };
}

export function computeEttvd(runStatsData, runConfigData, runBosses, totalDropProbsData) {
  let totalRunSecs = 0;
  for (const run of runConfigData) {
    if (runBosses[run.id] && runStatsData[run.id]) totalRunSecs += runStatsData[run.id].totalSecs;
  }
  if (totalRunSecs === 0 || !totalDropProbsData) return null;
  const p = totalDropProbsData;
  const secs = (prob) => prob > 0 ? totalRunSecs / prob : null;
  return { total: secs(p.total), items: secs(p.itemProb), rune: secs(p.runeProb),
    skiller: secs(p.skillerProb), valueSc: secs(p.valuableScProb) };
}

// ── State helpers ──────────────────────────────────────────────────────────

function makeSlot() {
  return { preset: null, custom: { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 } };
}

function makeCharmEntry() {
  return { preset: null, count: 1, custom: { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 } };
}

function makeGear() {
  const gear = {};
  for (const { id } of GEAR_SLOTS) {
    gear[id] = id === 'charms' ? [] : makeSlot();
  }
  return gear;
}

const DEFAULT_COLD_MASTERY = 20;
const DEFAULT_FOLDS = { breakdown: true, dropOddsBoss: true };
const DEFAULT_TARGET_PRESET_ID = 'Standard';

function makeDefaultState() {
  return {
    gear: makeGear(),
    coldMasteryBase: DEFAULT_COLD_MASTERY,
    run: { bosses: { ...DEFAULT_BOSSES } },
    ui: { folds: { ...DEFAULT_FOLDS } },
    targetPresetId: DEFAULT_TARGET_PRESET_ID,
  };
}

function encodeState(state) {
  const gear = {};
  for (const { id } of GEAR_SLOTS) {
    if (id === 'charms') continue;
    const slot = state.gear[id];
    if (slot.preset !== null) {
      const entry = { p: slot.preset };
      if (slot.preset === 'custom') {
        const c = slot.custom;
        if (c.name)       entry.n  = c.name;
        if (c.fcr)        entry.f  = c.fcr;
        if (c.mf)         entry.m  = c.mf;
        if (c.allSkills)  entry.a  = c.allSkills;
        if (c.coldSkills) entry.cs = c.coldSkills;
      }
      gear[id] = entry;
    }
  }
  const charmEntries = state.gear.charms
    .filter(c => c.preset !== null)
    .map(c => {
      const entry = { p: c.preset };
      if (c.preset === 'custom') {
        const cu = c.custom;
        if (cu.name)       entry.n  = cu.name;
        if (cu.fcr)        entry.f  = cu.fcr;
        if (cu.mf)         entry.m  = cu.mf;
        if (cu.allSkills)  entry.a  = cu.allSkills;
        if (cu.coldSkills) entry.cs = cu.coldSkills;
      } else if ((c.count ?? 1) > 1) {
        entry.qty = c.count;
      }
      return entry;
    });
  const out = {};
  if (Object.keys(gear).length) out.gear = gear;
  if (charmEntries.length) out.ch = charmEntries;
  if (state.coldMasteryBase !== DEFAULT_COLD_MASTERY) out.cm = state.coldMasteryBase;
  const bosses = {};
  for (const [k, v] of Object.entries(state.run.bosses)) {
    if (v === (DEFAULT_BOSSES[k] ?? false)) continue;
    bosses[k] = v ? 1 : 0;
  }
  if (Object.keys(bosses).length) out.bosses = bosses;
  const uf = Object.entries(state.ui.folds).filter(([, v]) => !v).map(([k]) => k);
  if (uf.length) out.uf = uf;
  return Object.keys(out).length ? btoa(JSON.stringify(out)) : null;
}

function decodeState(b64, state) {
  try {
    const out = JSON.parse(atob(b64));
    if (out.gear) {
      for (const { id } of GEAR_SLOTS) {
        if (id === 'charms') continue;
        if (out.gear[id]) {
          const e = out.gear[id];
          state.gear[id].preset = e.p ?? null;
          if (e.p === 'custom') {
            state.gear[id].custom = { name: e.n ?? '', fcr: e.f ?? 0, mf: e.m ?? 0,
              allSkills: e.a ?? 0, coldSkills: e.cs ?? 0 };
          }
        }
      }
    }
    if (out.ch) {
      state.gear.charms = out.ch.map(e => {
        const entry = makeCharmEntry();
        entry.preset = e.p ?? null;
        if (e.p === 'custom') {
          entry.custom = { name: e.n ?? '', fcr: e.f ?? 0, mf: e.m ?? 0,
            allSkills: e.a ?? 0, coldSkills: e.cs ?? 0 };
        } else if (e.qty) {
          entry.count = e.qty;
        }
        return entry;
      });
    }
    if (out.cm != null) state.coldMasteryBase = out.cm;
    if (out.bosses) {
      for (const [k, v] of Object.entries(out.bosses)) state.run.bosses[k] = !!v;
    }
    if (out.uf) {
      for (const key of out.uf) { if (key in state.ui.folds) state.ui.folds[key] = false; }
    }
    return true;
  } catch {
    return false;
  }
}

function findSetItemByName(name) {
  if (!name) return null;
  for (const presets of Object.values(PRESET_ITEMS.value)) {
    const matched = presets.find(p => p.set_name && p.name === name);
    if (matched) return matched;
  }
  return null;
}

function slotStats(slot) {
  if (!slot.preset) return { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
  if (slot.preset === 'custom') {
    const setMatch = findSetItemByName(slot.custom.name?.trim());
    if (setMatch) return { ...slot.custom, set_name: setMatch.set_name, set_bonuses: setMatch.set_bonuses };
    return slot.custom;
  }
  for (const presets of Object.values(PRESET_ITEMS.value)) {
    const item = presets.find(p => p.id === slot.preset);
    if (item) return item;
  }
  return { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
}

function singleCharmStats(charm) {
  if (!charm.preset) return { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
  if (charm.preset === 'custom') return charm.custom;
  const item = (PRESET_ITEMS.value['charms'] ?? []).find(p => p.id === charm.preset)
    ?? { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
  const n = item.unique ? 1 : (charm.count ?? 1);
  if (n === 1) return item;
  return { fcr: (item.fcr || 0) * n, mf: (item.mf || 0) * n,
           allSkills: (item.allSkills || 0) * n, coldSkills: (item.coldSkills || 0) * n };
}

function charmSlotStats(charmsArray) {
  const t = { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
  for (const charm of charmsArray) {
    const s = singleCharmStats(charm);
    t.fcr        += s.fcr        || 0;
    t.mf         += s.mf         || 0;
    t.allSkills  += s.allSkills  || 0;
    t.coldSkills += s.coldSkills || 0;
  }
  return t;
}

// ── Reactive state ─────────────────────────────────────────────────────────

const state = reactive(makeDefaultState());

const stateError = ref(null);

const params = new URLSearchParams(window.location.search);
if (params.has('s') && !decodeState(params.get('s'), state)) {
  Object.assign(state, makeDefaultState());
  stateError.value = 'Saved state could not be loaded (it may be from an older version). Starting fresh.';
}

// ── Shared data refs (populated via onMounted fetch) ───────────────────────

const runConfig = ref([]);
const monsterDb = ref(null);

// ── Build factory ──────────────────────────────────────────────────────────
// Creates a set of Vue computeds for one gear configuration.
// getSlotStats(slotId) → { fcr, mf, allSkills, coldSkills }

function computeSetBonuses(getSlotStats) {
  const sets = {};
  for (const { id: slotId } of GEAR_SLOTS) {
    const item = getSlotStats(slotId);
    if (!item?.set_name) continue;
    if (!sets[item.set_name]) sets[item.set_name] = { count: 0, items: [] };
    sets[item.set_name].count++;
    sets[item.set_name].items.push(item);
  }

  let fcr = 0, mf = 0, allSkills = 0, coldSkills = 0;
  const activeSets = [];

  for (const [setName, { count, items }] of Object.entries(sets)) {
    if (count < 2) continue;
    let sFcr = 0, sMf = 0, sAll = 0, sCold = 0;
    for (const item of items) {
      for (const b of (item.set_bonuses ?? [])) {
        if (b.pieces <= count) {
          sFcr  += b.fcr        || 0;
          sMf   += b.mf         || 0;
          sAll  += b.allSkills  || 0;
          sCold += b.coldSkills || 0;
        }
      }
    }
    for (const b of (SET_LEVEL_BONUSES.value[setName] ?? [])) {
      if (b.pieces <= count) {
        sFcr  += b.fcr        || 0;
        sMf   += b.mf         || 0;
        sAll  += b.allSkills  || 0;
        sCold += b.coldSkills || 0;
      }
    }
    fcr += sFcr; mf += sMf; allSkills += sAll; coldSkills += sCold;
    const total = SET_SIZES.value[setName] ?? count;
    activeSets.push({ name: setName, pieces: count, total, fcr: sFcr, mf: sMf, allSkills: sAll, coldSkills: sCold });
  }

  return { fcr, mf, allSkills, coldSkills, activeSets };
}

function makeBuild(getSlotStats) {
  const setBonuses   = computed(() => computeSetBonuses(getSlotStats));
  const gearTotals   = computed(() => {
    const base   = computeGearTotals(getSlotStats);
    const bonus  = setBonuses.value;
    return {
      fcr:        base.fcr        + bonus.fcr,
      mf:         base.mf         + bonus.mf,
      allSkills:  base.allSkills  + bonus.allSkills,
      coldSkills: base.coldSkills + bonus.coldSkills,
    };
  });

  const totalFCR        = computed(() => gearTotals.value.fcr);
  const totalMF         = computed(() => gearTotals.value.mf);
  const totalAllSkills  = computed(() => gearTotals.value.allSkills);
  const totalColdSkills = computed(() => gearTotals.value.coldSkills);
  const effectiveColdMastery = computed(() =>
    state.coldMasteryBase + totalAllSkills.value + totalColdSkills.value
  );

  const fcrBreakpoint = computed(() => computeFcrBreakpoint(totalFCR.value));
  const fcrTooltip    = computed(() => computeFcrTooltip(totalFCR.value));
  const fcrBadgeClass = computed(() => computeFcrBadgeClass(totalFCR.value));

  const combat = computed(() => computeCombat(gearTotals.value, effectiveColdMastery.value));
  const blizzDps          = computed(() => combat.value.blizzDps);
  const iceBlastDps       = computed(() => combat.value.iceBlastDps);
  const totalDps          = computed(() => combat.value.totalDps);
  const combatAssumptions = computed(() => computeCombatAssumptions(combat.value));

  const runStats = computed(() => {
    if (!runConfig.value.length || !monsterDb.value) return {};
    return computeRunStats(combat.value, runConfig.value, monsterDb.value, state.run.bosses);
  });

  const runDropProbs = computed(() => {
    if (!monsterDb.value) return {};
    const valuableSet = new Set(monsterDb.value.valuables);
    return computeRunDropProbs(totalMF.value, runConfig.value, monsterDb.value, state.run.bosses, valuableSet);
  });

  const totalDropProbs = computed(() => aggregateDropProbs(runDropProbs.value));

  const ettvd = computed(() =>
    computeEttvd(runStats.value, runConfig.value, state.run.bosses, totalDropProbs.value)
  );

  const runTimeSummary = computed(() => {
    let travel = 0, kill = 0;
    for (const [id, s] of Object.entries(runStats.value)) {
      if (!state.run.bosses[id]) continue;
      travel += s.travelSecs;
      kill   += s.killSecs;
    }
    const total = travel + kill;
    return total > 0 ? { travel, kill, total } : null;
  });

  const activeSetBonuses = computed(() => setBonuses.value.activeSets);

  return {
    totalFCR, totalMF, totalAllSkills, totalColdSkills,
    effectiveColdMastery, fcrBreakpoint, fcrTooltip, fcrBadgeClass,
    blizzDps, iceBlastDps, totalDps, combatAssumptions,
    runStats, runDropProbs, totalDropProbs, ettvd, runTimeSummary,
    activeSetBonuses,
  };
}

// ── Build instances ────────────────────────────────────────────────────────

const currentBuild = makeBuild((slotId) =>
  slotId === 'charms' ? charmSlotStats(state.gear.charms) : slotStats(state.gear[slotId])
);

// ── Target gear UI helpers ─────────────────────────────────────────────────

const targetPreset = computed(() =>
  TARGET_GEAR_PRESETS.value.find(p => p.id === state.targetPresetId) ?? null
);

function getTargetSlotItem(slotId) {
  const preset = targetPreset.value;
  if (!preset) return null;
  const itemId = preset.slots[slotId];
  if (!itemId) return null;
  return (PRESET_ITEMS.value[slotId] ?? []).find(p => p.id === itemId) ?? null;
}

const targetSlots = computed(() => {
  const out = {};
  for (const { id } of GEAR_SLOTS) {
    const item = getTargetSlotItem(id);
    out[id] = { item, stats: item ?? { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 } };
  }
  return out;
});

const targetBuild = makeBuild((slotId) => {
  if (slotId === 'charms') return { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
  return getTargetSlotItem(slotId) ?? { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
});

// ── URL sync ───────────────────────────────────────────────────────────────

watch(state, () => {
  const encoded = encodeState(state);
  history.replaceState(null, '', encoded ? `?s=${encoded}` : location.pathname);
}, { deep: true });

// ── GearSlot component ─────────────────────────────────────────────────────

const GearSlot = defineComponent({
  props: {
    slotId:     { type: String, required: true },
    slotLabel:  { type: String, required: true },
    presets:    { type: Array,  required: true },
    modelValue: { type: Object, required: true },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const basisId = ref('');

    function update(patch) {
      const next = { ...props.modelValue, ...patch };
      if (patch.preset && patch.preset !== 'custom') {
        next.custom = { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
      }
      emit('update:modelValue', next);
    }
    function updateCustom(patch) {
      emit('update:modelValue', {
        ...props.modelValue,
        custom: { ...props.modelValue.custom, ...patch },
      });
    }
    function applyBasis() {
      const id = basisId.value;
      if (!id) return;
      const item = (props.presets ?? []).find(p => p.id === id);
      if (item) {
        updateCustom({
          name:       item.name,
          fcr:        item.fcr        ?? 0,
          mf:         item.mf         ?? 0,
          allSkills:  item.allSkills  ?? 0,
          coldSkills: item.coldSkills ?? 0,
        });
      }
      basisId.value = '';
    }
    function stats() {
      const slot = props.modelValue;
      if (!slot.preset || slot.preset === 'custom') return slot.custom;
      return (props.presets ?? []).find(p => p.id === slot.preset) ?? { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
    }
    const realPresets = computed(() => (props.presets ?? []).filter(p => p.id !== 'custom'));
    const matchedSetItem = computed(() => {
      if (props.modelValue.preset !== 'custom') return null;
      const name = props.modelValue.custom.name?.trim();
      if (!name) return null;
      return (props.presets ?? []).find(p => p.set_name && p.name === name) ?? null;
    });
    return { update, updateCustom, applyBasis, stats, basisId, realPresets, matchedSetItem };
  },
  template: `
    <div class="gear-slot">
      <label class="slot-label">{{ slotLabel }}</label>
      <select
        :value="modelValue.preset ?? ''"
        @change="update({ preset: $event.target.value || null })"
        class="slot-select"
      >
        <option value="">— none —</option>
        <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>

      <div v-if="modelValue.preset" class="stat-pills">
        <span v-if="matchedSetItem && modelValue.preset !== 'custom'" class="pill pill-set-match" :title="'Name matches ' + matchedSetItem.set_name + ' set item — counted towards set bonus'">Set: {{ matchedSetItem.set_name }}</span>
        <span v-if="stats().fcr"       class="pill pill-fcr"   title="Faster Cast Rate — reduces casting animation length">FCR +{{ stats().fcr }}%</span>
        <span v-if="stats().mf"        class="pill pill-mf"    title="Magic Find — increases chance of finding magic, rare, set, and unique items">MF +{{ stats().mf }}%</span>
        <span v-if="stats().allSkills"  class="pill pill-skill" title="+All Skills — adds to all character skill levels">+{{ stats().allSkills }} All</span>
        <span v-if="stats().coldSkills" class="pill pill-cold"  title="+Cold Skills — adds to cold skill levels only">+{{ stats().coldSkills }} Cold</span>
      </div>

      <div v-if="modelValue.preset === 'custom'" class="custom-inputs">
        <select v-model="basisId" @change="applyBasis" class="custom-basis-select" title="Copy stats from an existing item as a starting point">
          <option value="">Start from...</option>
          <option v-for="p in realPresets" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <input type="text"   placeholder="Name"       :value="modelValue.custom.name"       @input="updateCustom({ name: $event.target.value })"              class="custom-text" />
        <label>FCR <input   type="number" min="0" :value="modelValue.custom.fcr"        @input="updateCustom({ fcr: +$event.target.value })"       class="custom-num" /></label>
        <label>MF  <input   type="number" min="0" :value="modelValue.custom.mf"         @input="updateCustom({ mf: +$event.target.value })"        class="custom-num" /></label>
        <label>+All <input  type="number" min="0" :value="modelValue.custom.allSkills"  @input="updateCustom({ allSkills: +$event.target.value })"  class="custom-num" /></label>
        <label>+Cold <input type="number" min="0" :value="modelValue.custom.coldSkills" @input="updateCustom({ coldSkills: +$event.target.value })" class="custom-num" /></label>
      </div>

      <div v-if="modelValue.preset === 'custom' && matchedSetItem" class="custom-stat-pills">
        <span class="pill pill-set-match" :title="'Name matches ' + matchedSetItem.set_name + ' set item — counted towards set bonus'">Set: {{ matchedSetItem.set_name }}</span>
      </div>
    </div>
  `,
});

const GROUP_A = ['head', 'amulet', 'weapon', 'shield', 'armor'];
const GROUP_B = ['gloves', 'belt', 'boots', 'ring1', 'ring2'];

// ── CharmsPanel component ──────────────────────────────────────────────────

const CharmsPanel = defineComponent({
  props: {
    modelValue: { type: Array,  required: true },
    presets:    { type: Array,  required: true },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    function emit_(next) { emit('update:modelValue', next); }

    function addCharm() {
      emit_([...props.modelValue, makeCharmEntry()]);
    }

    function removeCharm(idx) {
      const next = [...props.modelValue];
      next.splice(idx, 1);
      emit_(next);
    }

    function updateCharm(idx, presetVal) {
      const next = props.modelValue.map((c, i) => {
        if (i !== idx) return c;
        const updated = { ...c, preset: presetVal || null };
        if (presetVal && presetVal !== 'custom') {
          updated.custom = { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
        }
        return updated;
      });
      emit_(next);
    }

    function updateCharmCustom(idx, patch) {
      emit_(props.modelValue.map((c, i) =>
        i === idx ? { ...c, custom: { ...c.custom, ...patch } } : c
      ));
    }

    function updateCharmCount(idx, val) {
      emit_(props.modelValue.map((c, i) =>
        i === idx ? { ...c, count: Math.max(1, val || 1) } : c
      ));
    }

    function matchedUniquePreset(charm) {
      if (charm.preset !== 'custom') return null;
      const name = charm.custom?.name?.trim();
      if (!name) return null;
      return (props.presets ?? []).find(p => p.unique && p.name === name) ?? null;
    }

    function isUniqueCharm(charm) {
      if (!charm.preset || charm.preset === 'custom') return !!matchedUniquePreset(charm);
      return (props.presets ?? []).find(p => p.id === charm.preset)?.unique ?? false;
    }

    function isDisabled(preset, currentIdx) {
      if (!preset.unique) return false;
      return props.modelValue.some((c, i) => {
        if (i === currentIdx) return false;
        if (c.preset === preset.id) return true;
        return matchedUniquePreset(c)?.id === preset.id;
      });
    }

    function charmStats(charm) {
      if (!charm.preset || charm.preset === 'custom') return charm.custom;
      const base = (props.presets ?? []).find(p => p.id === charm.preset)
        ?? { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
      const n = isUniqueCharm(charm) ? 1 : (charm.count ?? 1);
      if (n === 1) return base;
      return { fcr: (base.fcr || 0) * n, mf: (base.mf || 0) * n,
               allSkills: (base.allSkills || 0) * n, coldSkills: (base.coldSkills || 0) * n };
    }

    function sunderLabel(charm) {
      const item = (props.presets ?? []).find(p => p.id === charm.preset);
      return item?.sunder ? item.sunder : null;
    }

    const charmBasisIds = reactive({});
    function applyCharmBasis(idx) {
      const id = charmBasisIds[idx];
      if (!id) return;
      const item = (props.presets ?? []).find(p => p.id === id);
      if (item) {
        updateCharmCustom(idx, {
          name:       item.name,
          fcr:        item.fcr        ?? 0,
          mf:         item.mf         ?? 0,
          allSkills:  item.allSkills  ?? 0,
          coldSkills: item.coldSkills ?? 0,
        });
      }
      charmBasisIds[idx] = '';
    }
    const realPresets = computed(() => (props.presets ?? []).filter(p => p.id !== 'custom'));

    return { addCharm, removeCharm, updateCharm, updateCharmCustom, updateCharmCount, isUniqueCharm, isDisabled, charmStats, sunderLabel, charmBasisIds, applyCharmBasis, realPresets, matchedUniquePreset };
  },
  template: `
    <div class="charms-panel">
      <div class="charms-panel-header">
        <span class="slot-label">Charms</span>
        <button @click="addCharm" class="charm-add">+ Add</button>
      </div>
      <div v-if="modelValue.length" class="charms-list">
        <div v-for="(charm, idx) in modelValue" :key="idx" class="charm-row">
          <div class="charm-select-group">
            <select
              :value="charm.preset ?? ''"
              @change="updateCharm(idx, $event.target.value)"
              class="slot-select"
            >
              <option value="">— select —</option>
              <option
                v-for="p in presets" :key="p.id" :value="p.id"
                :disabled="isDisabled(p, idx)"
              >{{ p.name }}</option>
            </select>
            <input v-if="charm.preset && charm.preset !== 'custom' && !isUniqueCharm(charm)"
              type="number" min="1"
              :value="charm.count ?? 1"
              @input="updateCharmCount(idx, +$event.target.value)"
              class="charm-count"
            />
            <div v-else-if="charm.preset && charm.preset !== 'custom'" class="charm-count-spacer">× 1</div>
            <button @click="removeCharm(idx)" class="charm-remove" title="Remove charm">&times;</button>
          </div>
          <div v-if="charm.preset && charm.preset !== 'custom'" class="stat-pills">
            <span v-if="sunderLabel(charm)" class="pill pill-sunder" :title="'Sunders ' + sunderLabel(charm) + ' immunity'">Sunders {{ sunderLabel(charm) }}</span>
            <span v-if="charmStats(charm).fcr"        class="pill pill-fcr"   title="Faster Cast Rate">FCR +{{ charmStats(charm).fcr }}%</span>
            <span v-if="charmStats(charm).mf"         class="pill pill-mf"    title="Magic Find">MF +{{ charmStats(charm).mf }}%</span>
            <span v-if="charmStats(charm).allSkills"  class="pill pill-skill" title="+All Skills">+{{ charmStats(charm).allSkills }} All</span>
            <span v-if="charmStats(charm).coldSkills" class="pill pill-cold"  title="+Cold Skills">+{{ charmStats(charm).coldSkills }} Cold</span>
          </div>
          <div v-if="charm.preset === 'custom'" class="charm-custom-inputs">
            <select :value="charmBasisIds[idx] ?? ''" @change="charmBasisIds[idx] = $event.target.value; applyCharmBasis(idx)" class="custom-basis-select" title="Copy stats from an existing charm as a starting point">
              <option value="">Start from...</option>
              <option v-for="p in realPresets" :key="p.id" :value="p.id" :disabled="isDisabled(p, idx)">{{ p.name }}</option>
            </select>
            <input type="text" placeholder="Name" :value="charm.custom.name" @input="updateCharmCustom(idx, { name: $event.target.value })" class="custom-text" />
            <label>FCR  <input type="number" min="0" :value="charm.custom.fcr"        @input="updateCharmCustom(idx, { fcr:        +$event.target.value })" class="custom-num" /></label>
            <label>MF   <input type="number" min="0" :value="charm.custom.mf"         @input="updateCharmCustom(idx, { mf:         +$event.target.value })" class="custom-num" /></label>
            <label>+All <input type="number" min="0" :value="charm.custom.allSkills"  @input="updateCharmCustom(idx, { allSkills:  +$event.target.value })" class="custom-num" /></label>
            <label>+Cold<input type="number" min="0" :value="charm.custom.coldSkills" @input="updateCharmCustom(idx, { coldSkills: +$event.target.value })" class="custom-num" /></label>
          </div>
          <div v-if="charm.preset === 'custom' && matchedUniquePreset(charm)" class="charm-custom-stat-pills">
            <span class="pill pill-unique-match" title="Name matches a unique charm — treated as unique (only one allowed)">Unique: {{ matchedUniquePreset(charm).name }}</span>
          </div>
        </div>
      </div>
    </div>
  `,
});

// ── App ────────────────────────────────────────────────────────────────────

createApp({
  components: { GearSlot, CharmsPanel },
  setup() {
    onMounted(async () => {
      try {
        const [rcRes, dbRes] = await Promise.all([
          fetch('data/run_config.json', { cache: 'no-cache' }),
          fetch('data/db.json',         { cache: 'no-cache' }),
        ]);
        const [rc, db] = await Promise.all([rcRes.json(), dbRes.json()]);
        runConfig.value = rc.runs;
        monsterDb.value = db;
        const itemsBySlot = db.gear.items_by_slot;
        for (const { id } of GEAR_SLOTS) {
          if (id === 'charms') {
            PRESET_ITEMS.value[id] = [...(itemsBySlot[id] ?? []), CUSTOM_CHARM];
          } else {
            PRESET_ITEMS.value[id] = [...(itemsBySlot[id] ?? []), CUSTOM_ITEM];
          }
        }
        SET_LEVEL_BONUSES.value = db.gear.set_level_bonuses ?? {};
        SET_SIZES.value = db.gear.set_sizes ?? {};
        TARGET_GEAR_PRESETS.value = Object.entries(db.gear.presets).map(
          ([id, slots]) => ({ id, name: id, slots })
        );
        const charmPresetIds = new Set((PRESET_ITEMS.value['charms'] ?? []).map(p => p.id));
        const hasUnknownPreset = GEAR_SLOTS.some(({ id }) => {
          if (id === 'charms') {
            return state.gear.charms.some(c =>
              c.preset && c.preset !== 'custom' && !charmPresetIds.has(c.preset)
            );
          }
          const preset = state.gear[id].preset;
          return preset && preset !== 'custom' &&
            !PRESET_ITEMS.value[id].some(p => p.id === preset);
        });
        if (hasUnknownPreset) {
          stateError.value = 'Saved state references items from an older version and has been reset.';
          Object.assign(state, makeDefaultState());
        }
      } catch (e) {
        console.error('Failed to load data', e);
        stateError.value = 'Failed to load app data. Please refresh the page.';
      }
    });

    function fmtOneIn(prob) {
      if (!prob || prob <= 0) return '—';
      return `1/${Math.round(1 / prob).toLocaleString()}`;
    }

    function fmtEttvd(secs) {
      if (secs < 3600) return `${Math.round(secs / 60)} min`;
      const h = Math.floor(secs / 3600);
      const m = Math.round((secs % 3600) / 60);
      return m > 0 ? `${h}h ${m}min` : `${h}h`;
    }

    return {
      state,
      stateError,
      GEAR_SLOTS,
      PRESET_ITEMS,
      GROUP_A,
      GROUP_B,
      runConfig,
      TARGET_GEAR_PRESETS,
      targetPreset,
      targetSlots,
      fmtEttvd,
      fmtOneIn,
      effUniqueMF,
      effSetMF,

      // Current build — same names as before so the template is unchanged
      activeSetBonuses:     currentBuild.activeSetBonuses,
      totalFCR:             currentBuild.totalFCR,
      totalMF:              currentBuild.totalMF,
      totalAllSkills:       currentBuild.totalAllSkills,
      totalColdSkills:      currentBuild.totalColdSkills,
      effectiveColdMastery: currentBuild.effectiveColdMastery,
      fcrBreakpoint:        currentBuild.fcrBreakpoint,
      fcrBadgeClass:        currentBuild.fcrBadgeClass,
      fcrTooltip:           currentBuild.fcrTooltip,
      blizzDps:             currentBuild.blizzDps,
      iceBlastDps:          currentBuild.iceBlastDps,
      totalDps:             currentBuild.totalDps,
      combatAssumptions:    currentBuild.combatAssumptions,
      runStats:             currentBuild.runStats,
      runDropProbs:         currentBuild.runDropProbs,
      totalDropProbs:       currentBuild.totalDropProbs,
      ettvd:                currentBuild.ettvd,
      runTimeSummary:       currentBuild.runTimeSummary,

      // Target build — 'target' prefix keeps template names distinct
      targetActiveSetBonuses:     targetBuild.activeSetBonuses,
      targetTotalFCR:             targetBuild.totalFCR,
      targetTotalMF:              targetBuild.totalMF,
      targetTotalAllSkills:       targetBuild.totalAllSkills,
      targetTotalColdSkills:      targetBuild.totalColdSkills,
      targetEffectiveColdMastery: targetBuild.effectiveColdMastery,
      targetFcrBreakpoint:        targetBuild.fcrBreakpoint,
      targetFcrBadgeClass:        targetBuild.fcrBadgeClass,
      targetFcrTooltip:           targetBuild.fcrTooltip,
      targetBlizzDps:             targetBuild.blizzDps,
      targetIceBlastDps:          targetBuild.iceBlastDps,
      targetTotalDps:             targetBuild.totalDps,
      targetCombatAssumptions:    targetBuild.combatAssumptions,
      targetEttvd:                targetBuild.ettvd,
    };
  },
  template: `
    <div class="app-root">
      <header class="app-header sticky-header">
        <h1>D2R Blizzard Sorc — <abbr title="Expected Time To Valuable Drop — estimated average runs until a desirable item drops, given your MF and run routine">ETTVD</abbr> Optimizer</h1>
      </header>

      <div v-if="stateError" class="error-banner" role="alert">
        {{ stateError }}
        <button class="error-banner-close" @click="stateError = null" aria-label="Dismiss">&times;</button>
      </div>

      <main class="app-grid">
        <div class="left-col">
          <section class="gear-panel">
            <h2 class="panel-title">Current Gear</h2>
            <div class="slot-group">
              <gear-slot
                v-for="id in GROUP_A" :key="id"
                :slot-id="id"
                :slot-label="GEAR_SLOTS.find(s => s.id === id).label"
                :presets="PRESET_ITEMS[id] ?? []"
                v-model="state.gear[id]"
              />
            </div>
            <div class="slot-group">
              <gear-slot
                v-for="id in GROUP_B" :key="id"
                :slot-id="id"
                :slot-label="GEAR_SLOTS.find(s => s.id === id).label"
                :presets="PRESET_ITEMS[id] ?? []"
                v-model="state.gear[id]"
              />
            </div>

            <div v-if="activeSetBonuses.length" class="set-bonuses-block">
              <div class="set-bonuses-header">Set Bonuses</div>
              <div v-for="sb in activeSetBonuses" :key="sb.name" class="set-bonus-row">
                <div class="set-bonus-meta">
                  <span class="set-bonus-name">{{ sb.name }}</span>
                  <span class="set-pips" :title="sb.pieces + ' of ' + sb.total + ' pieces equipped'">
                    <span v-for="i in sb.total" :key="i" :class="i <= sb.pieces ? 'pip pip-on' : 'pip pip-off'">{{ i <= sb.pieces ? '●' : '○' }}</span>
                  </span>
                </div>
                <div class="stat-pills set-bonus-pills">
                  <span v-if="sb.fcr"        class="pill pill-fcr"   title="Set bonus FCR">FCR +{{ sb.fcr }}%</span>
                  <span v-if="sb.mf"         class="pill pill-mf"    title="Set bonus MF">MF +{{ sb.mf }}%</span>
                  <span v-if="sb.allSkills"  class="pill pill-skill" title="Set bonus +All Skills">+{{ sb.allSkills }} All</span>
                  <span v-if="sb.coldSkills" class="pill pill-cold"  title="Set bonus +Cold Skills">+{{ sb.coldSkills }} Cold</span>
                </div>
              </div>
            </div>

            <div class="charms-section">
              <charms-panel
                :presets="PRESET_ITEMS['charms'] ?? []"
                v-model="state.gear.charms"
              />
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title">Stats</h2>
            <div class="summary-pills">
              <span class="pill pill-fcr" :title="fcrTooltip">
                FCR {{ totalFCR }}%
                <span class="fcr-badge" :class="fcrBadgeClass" :title="fcrTooltip">{{ fcrBreakpoint.frames }}f</span>
              </span>
              <span v-if="totalMF"         class="pill pill-mf"    title="Magic Find — increases chance of finding magic, rare, set, and unique items">MF +{{ totalMF }}%</span>
              <span v-if="totalAllSkills"  class="pill pill-skill" title="+All Skills — adds to all character skill levels">+{{ totalAllSkills }} All Skills</span>
              <span v-if="totalColdSkills" class="pill pill-cold"  title="+Cold Skills — adds to cold skill levels only">+{{ totalColdSkills }} Cold Skills</span>
              <span class="pill pill-cold" title="Cold Mastery — reduces enemy cold resistance; effective level includes +All Skills and +Cold Skills from gear">Cold Mastery Lv {{ effectiveColdMastery }}</span>
            </div>
            <div class="cm-input-row">
              <label class="cm-label">
                Cold Mastery base pts (0–20)
                <input type="number" min="0" max="20" v-model.number="state.coldMasteryBase" class="custom-num" />
                <span class="cm-breakdown">(+{{ totalAllSkills + totalColdSkills }} from gear)</span>
              </label>
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title">
              Combat
              <span class="info-icon" :title="combatAssumptions">i</span>
            </h2>
            <div class="summary-pills">
              <span class="pill pill-total" title="Combined Blizzard + Ice Blast DPS (approximate, single-target boss)">
                Total ~{{ Math.round(totalDps).toLocaleString() }} DPS
              </span>
            </div>
            <div class="summary-pills">
              <span class="pill pill-skill" title="Blizzard damage per second (approximate, single-target boss)">
                Blizzard ~{{ Math.round(blizzDps).toLocaleString() }} DPS
              </span>
              <span class="pill pill-cold" title="Effective Ice Blast DPS accounting for hit rate and current FCR">
                Ice Blast ~{{ Math.round(iceBlastDps).toLocaleString() }} DPS
              </span>
            </div>
          </section>

          <!-- Drop Odds -->
          <section class="summary-block">
            <h2 class="panel-title">Drop Odds</h2>
            <div class="summary-pills">
              <span class="pill pill-mf" title="Effective MF applied to unique quality checks after diminishing returns: MF×250÷(MF+250)">
                Eff. Unique MF {{ Math.round(effUniqueMF(totalMF)) }}%
              </span>
              <span class="pill pill-mf" title="Effective MF applied to set quality checks after diminishing returns: MF×500÷(MF+500)">
                Eff. Set MF {{ Math.round(effSetMF(totalMF)) }}%
              </span>
            </div>

            <div class="breakdown-run-label">Per run cycle</div>
            <div class="breakdown-row breakdown-total">
              <span>Any valuable <span class="info-icon" title="P(at least one valuable drops across all selected bosses in one full run cycle)">i</span></span>
              <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.total) : '---' }}</span>
            </div>
            <div class="breakdown-row breakdown-sub">
              <span>Good Unique / Set Item <span class="info-icon" title="Any item from the Maxroll trade-value list — Shako, Oculus, Mara's Kaleidoscope, etc. Accounts for MF diminishing returns and the quality roll.">i</span></span>
              <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.itemProb) : '---' }}</span>
            </div>
            <div class="breakdown-row breakdown-sub">
              <span>Good Rune <span class="info-icon" title="Any rune Pul (r21) or better — tradeable for meaningful gear upgrades.">i</span></span>
              <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.runeProb) : '---' }}</span>
            </div>
            <div class="breakdown-row breakdown-sub">
              <span>Any Skiller GC <span class="info-icon" title="A magic Grand Charm with any class skill tab prefix (e.g. +1 Cold Skills, +1 Combat Skills, etc.) — all 8 classes, 3 tabs each. Accounts for magic quality roll, P(has a prefix), and the skiller affix fraction.">i</span></span>
              <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.skillerProb) : '---' }}</span>
            </div>
            <div class="breakdown-row breakdown-sub">
              <span>Valuable SC <span class="info-icon" title="A magic Small Charm with exactly +5 all res (Shimmering), +7% MF (of Good Luck), or +20 life (of Vita). Only the max roll counts. Accounts for P(has prefix/suffix) per the magic item layout distribution.">i</span></span>
              <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.valuableScProb) : '---' }}</span>
            </div>

            <div class="fold-section">
              <button class="fold-header" @click="state.ui.folds.dropOddsBoss = !state.ui.folds.dropOddsBoss">
                <span class="fold-arrow">{{ state.ui.folds.dropOddsBoss ? '▶' : '▼' }}</span>
                Per-boss breakdown
              </button>
              <div v-if="!state.ui.folds.dropOddsBoss" class="breakdown-content">
                <template v-if="totalDropProbs">
                  <template v-for="run in runConfig" :key="run.id">
                    <template v-if="run.available && state.run.bosses[run.id] && runDropProbs[run.id]">
                      <div class="breakdown-run-label">{{ run.label }}</div>
                      <div class="breakdown-row breakdown-total">
                        <span>Any valuable <span class="info-icon" title="P(at least one of: trade-value unique/set, good rune, skiller GC, or valuable SC drops this run)">i</span></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].total) }}</span>
                      </div>
                      <div class="breakdown-row breakdown-sub">
                        <span>Good Unique / Set Item <span class="info-icon" title="Any item from the Maxroll trade-value list — Shako, Oculus, Mara's Kaleidoscope, etc. Accounts for MF diminishing returns and the quality roll.">i</span></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].itemProb) }}</span>
                      </div>
                      <div class="breakdown-row breakdown-sub">
                        <span>Good Rune <span class="info-icon" title="Any rune Pul (r21) or better — tradeable for meaningful gear upgrades.">i</span></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].runeProb) }}</span>
                      </div>
                      <div class="breakdown-row breakdown-sub">
                        <span>Any Skiller GC <span class="info-icon" title="A magic Grand Charm with any class skill tab prefix (e.g. +1 Cold Skills, +1 Combat Skills, etc.) — all 8 classes, 3 tabs each. Accounts for magic quality roll, P(has a prefix), and the skiller affix fraction.">i</span></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].skillerProb) }}</span>
                      </div>
                      <div class="breakdown-row breakdown-sub">
                        <span>Valuable SC <span class="info-icon" title="A magic Small Charm with exactly +5 all res (Shimmering), +7% MF (of Good Luck), or +20 life (of Vita). Only the max roll counts. Accounts for P(has prefix/suffix) per the magic item layout distribution.">i</span></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].valuableScProb) }}</span>
                      </div>
                    </template>
                  </template>
                </template>
                <div v-else class="placeholder">Select a run above</div>
              </div>
            </div>
          </section>

          <hr class="section-divider" />

          <!-- Target Gear -->
          <section class="gear-panel target-panel">
            <div class="target-preset-row">
              <h2 class="panel-title" style="margin:0">Target Gear</h2>
              <label class="target-preset-label">
                Preset
                <select v-model="state.targetPresetId" class="slot-select target-preset-select">
                  <option v-for="p in TARGET_GEAR_PRESETS" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
              </label>
            </div>

            <div class="target-slot-group">
              <div v-for="id in GROUP_A" :key="id" class="target-slot-row">
                <span class="slot-label">{{ GEAR_SLOTS.find(s => s.id === id).label }}</span>
                <span :class="['target-slot-name', !targetSlots[id].item && 'target-slot-empty']">
                  {{ targetSlots[id].item?.name ?? '—' }}
                </span>
                <div class="stat-pills">
                  <span v-if="targetSlots[id].stats.fcr"        class="pill pill-fcr"   title="Faster Cast Rate">FCR +{{ targetSlots[id].stats.fcr }}%</span>
                  <span v-if="targetSlots[id].stats.mf"         class="pill pill-mf"    title="Magic Find">MF +{{ targetSlots[id].stats.mf }}%</span>
                  <span v-if="targetSlots[id].stats.allSkills"  class="pill pill-skill" title="+All Skills">+{{ targetSlots[id].stats.allSkills }} All</span>
                  <span v-if="targetSlots[id].stats.coldSkills" class="pill pill-cold"  title="+Cold Skills">+{{ targetSlots[id].stats.coldSkills }} Cold</span>
                </div>
              </div>
            </div>
            <div class="target-slot-group">
              <div v-for="id in GROUP_B" :key="id" class="target-slot-row">
                <span class="slot-label">{{ GEAR_SLOTS.find(s => s.id === id).label }}</span>
                <span :class="['target-slot-name', !targetSlots[id].item && 'target-slot-empty']">
                  {{ targetSlots[id].item?.name ?? '—' }}
                </span>
                <div class="stat-pills">
                  <span v-if="targetSlots[id].stats.fcr"        class="pill pill-fcr"   title="Faster Cast Rate">FCR +{{ targetSlots[id].stats.fcr }}%</span>
                  <span v-if="targetSlots[id].stats.mf"         class="pill pill-mf"    title="Magic Find">MF +{{ targetSlots[id].stats.mf }}%</span>
                  <span v-if="targetSlots[id].stats.allSkills"  class="pill pill-skill" title="+All Skills">+{{ targetSlots[id].stats.allSkills }} All</span>
                  <span v-if="targetSlots[id].stats.coldSkills" class="pill pill-cold"  title="+Cold Skills">+{{ targetSlots[id].stats.coldSkills }} Cold</span>
                </div>
              </div>
            </div>

            <div v-if="targetActiveSetBonuses.length" class="set-bonuses-block">
              <div class="set-bonuses-header">Set Bonuses</div>
              <div v-for="sb in targetActiveSetBonuses" :key="sb.name" class="set-bonus-row">
                <div class="set-bonus-meta">
                  <span class="set-bonus-name">{{ sb.name }}</span>
                  <span class="set-pips" :title="sb.pieces + ' of ' + sb.total + ' pieces equipped'">
                    <span v-for="i in sb.total" :key="i" :class="i <= sb.pieces ? 'pip pip-on' : 'pip pip-off'">{{ i <= sb.pieces ? '●' : '○' }}</span>
                  </span>
                </div>
                <div class="stat-pills set-bonus-pills">
                  <span v-if="sb.fcr"        class="pill pill-fcr"   title="Set bonus FCR">FCR +{{ sb.fcr }}%</span>
                  <span v-if="sb.mf"         class="pill pill-mf"    title="Set bonus MF">MF +{{ sb.mf }}%</span>
                  <span v-if="sb.allSkills"  class="pill pill-skill" title="Set bonus +All Skills">+{{ sb.allSkills }} All</span>
                  <span v-if="sb.coldSkills" class="pill pill-cold"  title="Set bonus +Cold Skills">+{{ sb.coldSkills }} Cold</span>
                </div>
              </div>
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title">Target Stats</h2>
            <div class="summary-pills">
              <span class="pill pill-fcr" :title="targetFcrTooltip">
                FCR {{ targetTotalFCR }}%
                <span class="fcr-badge" :class="targetFcrBadgeClass" :title="targetFcrTooltip">{{ targetFcrBreakpoint.frames }}f</span>
              </span>
              <span v-if="targetTotalMF"         class="pill pill-mf"    title="Magic Find">MF +{{ targetTotalMF }}%</span>
              <span v-if="targetTotalAllSkills"  class="pill pill-skill" title="+All Skills">+{{ targetTotalAllSkills }} All Skills</span>
              <span v-if="targetTotalColdSkills" class="pill pill-cold"  title="+Cold Skills">+{{ targetTotalColdSkills }} Cold Skills</span>
              <span class="pill pill-cold" title="Cold Mastery effective level includes +All Skills and +Cold Skills from target gear">Cold Mastery Lv {{ targetEffectiveColdMastery }}</span>
            </div>
            <div class="cm-input-row">
              <label class="cm-label">
                Cold Mastery base pts
                <span class="custom-num cm-readonly">{{ state.coldMasteryBase }}</span>
                <span class="cm-breakdown">(from above · +{{ targetTotalAllSkills + targetTotalColdSkills }} from target gear)</span>
              </label>
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title">
              Target Combat
              <span class="info-icon" :title="targetCombatAssumptions">i</span>
            </h2>
            <div class="summary-pills">
              <span class="pill pill-total" title="Combined Blizzard + Ice Blast DPS (approximate, single-target boss)">
                Total ~{{ Math.round(targetTotalDps).toLocaleString() }} DPS
              </span>
            </div>
            <div class="summary-pills">
              <span class="pill pill-skill" title="Blizzard damage per second (approximate, single-target boss)">
                Blizzard ~{{ Math.round(targetBlizzDps).toLocaleString() }} DPS
              </span>
              <span class="pill pill-cold" title="Effective Ice Blast DPS accounting for hit rate and target FCR">
                Ice Blast ~{{ Math.round(targetIceBlastDps).toLocaleString() }} DPS
              </span>
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title"><abbr title="Expected Time To Valuable Drop — estimated average time until a desirable item drops, given target gear, MF, and run routine">ETTVD</abbr>: Time To Valuable Drop</h2>
            <div :class="['ettvd-main', 'ettvd-target', !targetEttvd && 'ettvd-empty']">{{ targetEttvd ? fmtEttvd(targetEttvd.total) : '---' }}</div>
            <div class="ettvd-breakdown">
              <div class="breakdown-row breakdown-sub">
                <span>Good Unique / Set Item</span>
                <span>{{ targetEttvd ? fmtEttvd(targetEttvd.items) : '---' }}</span>
              </div>
              <div class="breakdown-row breakdown-sub">
                <span>Good Rune</span>
                <span>{{ targetEttvd ? fmtEttvd(targetEttvd.rune) : '---' }}</span>
              </div>
              <div class="breakdown-row breakdown-sub">
                <span>Any Skiller GC</span>
                <span>{{ targetEttvd ? fmtEttvd(targetEttvd.skiller) : '---' }}</span>
              </div>
              <div class="breakdown-row breakdown-sub">
                <span>Valuable SC</span>
                <span>{{ targetEttvd ? fmtEttvd(targetEttvd.valueSc) : '---' }}</span>
              </div>
            </div>
          </section>

        </div>

        <aside class="side-panel">

          <!-- ETTVD -->
          <section class="ettvd-block summary-block">
            <h2 class="panel-title"><abbr title="Expected Time To Valuable Drop — estimated average time until a desirable item drops, given your gear, MF, and run routine">ETTVD</abbr>: Time To Valuable Drop</h2>
            <div :class="['ettvd-main', !ettvd && 'ettvd-empty']">{{ ettvd ? fmtEttvd(ettvd.total) : '---' }}</div>
            <div class="ettvd-breakdown">
              <div class="breakdown-row breakdown-sub">
                <span>Good Unique / Set Item <span class="info-icon" title="Expected time between any item from the Maxroll trade-value list — Shako, Oculus, Mara's Kaleidoscope, etc. Accounts for MF diminishing returns and the quality roll.">i</span></span>
                <span>{{ ettvd ? fmtEttvd(ettvd.items) : '---' }}</span>
              </div>
              <div class="breakdown-row breakdown-sub">
                <span>Good Rune <span class="info-icon" title="Expected time between any Pul+ rune drop">i</span></span>
                <span>{{ ettvd ? fmtEttvd(ettvd.rune) : '---' }}</span>
              </div>
              <div class="breakdown-row breakdown-sub">
                <span>Any Skiller GC <span class="info-icon" title="Expected time between any class skiller Grand Charm drop">i</span></span>
                <span>{{ ettvd ? fmtEttvd(ettvd.skiller) : '---' }}</span>
              </div>
              <div class="breakdown-row breakdown-sub">
                <span>Valuable SC <span class="info-icon" title="Expected time between a max-roll +5 all res, +7% MF, or +20 life Small Charm drop">i</span></span>
                <span>{{ ettvd ? fmtEttvd(ettvd.valueSc) : '---' }}</span>
              </div>
            </div>
          </section>

          <!-- Run Routine -->
          <section class="summary-block">
            <h2 class="panel-title">Run Routine</h2>

            <div v-if="runConfig.length === 0" class="placeholder">Loading…</div>

            <div v-for="run in runConfig" :key="run.id" class="run-row">
              <label :class="['run-label', !run.available && 'run-disabled']">
                <input
                  type="checkbox"
                  :disabled="!run.available"
                  v-model="state.run.bosses[run.id]"
                  class="run-checkbox"
                />
                {{ run.label }}
                <span v-if="!run.available" class="coming-soon">coming soon</span>
              </label>
              <span
                v-if="run.available && runStats[run.id]"
                class="info-icon"
                :title="runStats[run.id].assumptions"
              >i</span>
            </div>

            <div class="breakdown-run-label">Per run cycle</div>
            <div class="breakdown-row breakdown-total">
              <span>Total</span><span>{{ runTimeSummary ? runTimeSummary.total.toFixed(1) + 's' : '---' }}</span>
            </div>
            <div class="breakdown-row breakdown-sub">
              <span>Travel</span><span>{{ runTimeSummary ? runTimeSummary.travel.toFixed(1) + 's' : '---' }}</span>
            </div>
            <div class="breakdown-row breakdown-sub">
              <span>Kill</span><span>{{ runTimeSummary ? runTimeSummary.kill.toFixed(1) + 's' : '---' }}</span>
            </div>

            <div class="fold-section">
              <button class="fold-header" @click="state.ui.folds.breakdown = !state.ui.folds.breakdown">
                <span class="fold-arrow">{{ state.ui.folds.breakdown ? '▶' : '▼' }}</span>
                Per-boss breakdown
              </button>
              <div v-if="!state.ui.folds.breakdown" class="breakdown-content">
                <template v-if="Object.values(runStats).some(s => s.hasKillData)">
                  <template v-for="run in runConfig" :key="run.id">
                    <template v-if="state.run.bosses[run.id] && runStats[run.id]?.hasKillData">
                      <div class="breakdown-run-label">{{ run.label }}</div>
                      <div class="breakdown-row">
                        <span>Travel <span class="info-icon" :title="runStats[run.id].travelDetail">i</span></span>
                        <span>{{ runStats[run.id].travelSecs.toFixed(1) }}s</span>
                      </div>
                      <div class="breakdown-row">
                        <span>Kill <span class="info-icon" :title="runStats[run.id].killDetail">i</span></span>
                        <span>{{ runStats[run.id].killSecs.toFixed(1) }}s</span>
                      </div>
                      <div class="breakdown-row breakdown-total">
                        <span>Total</span><span>{{ runStats[run.id].totalSecs.toFixed(1) }}s</span>
                      </div>
                    </template>
                  </template>
                </template>
                <div v-else class="placeholder">Select at least one</div>
              </div>
            </div>
          </section>

        </aside>
      </main>
    </div>
  `,
}).mount('#app');

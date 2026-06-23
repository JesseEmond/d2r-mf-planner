export const GEAR_SLOTS = [
  { id: 'head',    label: 'Head' },
  { id: 'amulet',  label: 'Amulet' },
  { id: 'weapon',  label: 'Weapon' },
  { id: 'shield',  label: 'Shield' },
  { id: 'armor',   label: 'Armor' },
  { id: 'gloves',  label: 'Gloves' },
  { id: 'belt',    label: 'Belt' },
  { id: 'boots',   label: 'Boots' },
  { id: 'ring1',   label: 'Ring 1' },
  { id: 'ring2',   label: 'Ring 2' },
  { id: 'charms',  label: 'Charms' },
];

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

const BLIZZARD_COOLDOWN_SECS  = 1.8;
const ICE_BLAST_HIT_RATE      = 0.80;
const D2_FPS                  = 25;
export const BLIZZARD_BOLTS_VS_BOSS  = 4;

// Hard points (base-allocated skill levels, blvl) for each skill in the build.
// +skills from gear does NOT boost synergy bonuses — synergies use blvl only.
const SKILL_HARD_PTS = {
  'Blizzard':      20,
  'Ice Blast':     20,
  'Ice Bolt':      20,
  'Glacial Spike': 20,
  'Frozen Orb':     0,
};

// D2R damage formula: standard per-level tier caps for ALL skills.
// EMinLev1-5 give the damage-per-level added at each tier boundary.
const DAMAGE_TIER_CAPS = [7, 8, 6, 6]; // last tier (5) is unlimited


// ── Stats ──────────────────────────────────────────────────────────────────
// Computed stat aggregates. Raw items (DB) and custom fields in Vue state
// stay as plain objects; Stats is only for values returned by accumulation
// functions.

export class Stats {
  constructor({ fcr=0, mf=0, allSkills=0, coldSkills=0, coldDmgPct=0, enemyColdResPct=0 } = {}) {
    this.fcr             = fcr;
    this.mf              = mf;
    this.allSkills       = allSkills;
    this.coldSkills      = coldSkills;
    this.coldDmgPct      = coldDmgPct;
    this.enemyColdResPct = enemyColdResPct;
  }
  add(other) {
    return new Stats({
      fcr:             this.fcr             + (other?.fcr             ?? 0),
      mf:              this.mf              + (other?.mf              ?? 0),
      allSkills:       this.allSkills       + (other?.allSkills       ?? 0),
      coldSkills:      this.coldSkills      + (other?.coldSkills      ?? 0),
      coldDmgPct:      this.coldDmgPct      + (other?.coldDmgPct      ?? 0),
      enemyColdResPct: this.enemyColdResPct + (other?.enemyColdResPct ?? 0),
    });
  }
  scale(n) {
    return new Stats({
      fcr:             this.fcr             * n,
      mf:              this.mf              * n,
      allSkills:       this.allSkills       * n,
      coldSkills:      this.coldSkills      * n,
      coldDmgPct:      this.coldDmgPct      * n,
      enemyColdResPct: this.enemyColdResPct * n,
    });
  }
  static zero() { return new Stats(); }
  static from(obj) { return new Stats(obj ?? {}); }
}

// ── Pure computation functions ─────────────────────────────────────────────
// No Vue dependency — the optimizer can call these directly.

export function effUniqueMF(rawMF) { return rawMF === 0 ? 0 : (rawMF * 250) / (rawMF + 250); }
export function effSetMF(rawMF)    { return rawMF === 0 ? 0 : (rawMF * 500) / (rawMF + 500); }

function qualityCheckProb(qp, mlvl, effMF) {
  const baseQc = Math.floor((qp.base_chance - Math.floor(mlvl / qp.divisor)) * 1024 / qp.quality_factor) + qp.base_chance;
  const qc = Math.min(Math.floor(baseQc * 100 / (100 + effMF)), qp.min_chance);
  return 1 / qc;
}

// Compute average base damage per hit/shard using the exact D2R formula.
// lvl is the effective skill level (hard pts + gear bonus).
// dat is a skill_data entry (from db.json or DEFAULT_SKILL_DATA).
function calcSkillAvgBase(lvl, dat) {
  function rawDamage(base, levs) {
    let raw = base;
    let remaining = lvl - 1;
    for (let i = 0; i <= DAMAGE_TIER_CAPS.length; i++) {
      if (remaining <= 0) break;
      const cap = i < DAMAGE_TIER_CAPS.length ? DAMAGE_TIER_CAPS[i] : Infinity;
      const inTier = cap === Infinity ? remaining : Math.min(remaining, cap);
      raw += inTier * (levs[i] ?? 0);
      remaining -= inTier;
    }
    return raw;
  }
  const levKeys = ['emin_lev1','emin_lev2','emin_lev3','emin_lev4','emin_lev5'];
  const levMaxKeys = ['emax_lev1','emax_lev2','emax_lev3','emax_lev4','emax_lev5'];
  const divisor = Math.pow(2, 8 - (dat.hit_shift ?? 8));
  const baseMin = Math.floor(rawDamage(dat.emin ?? 0, levKeys.map(k => dat[k] ?? 0)) / divisor);
  const baseMax = Math.floor(rawDamage(dat.emax ?? 0, levMaxKeys.map(k => dat[k] ?? 0)) / divisor);
  return (baseMin + baseMax) / 2;
}

function iceBlastsPerWindow(framesPerCast) {
  return (Math.floor(BLIZZARD_COOLDOWN_SECS / (framesPerCast / D2_FPS)) - 1) * ICE_BLAST_HIT_RATE;
}
function cmResistReduction(cmLevel) { return 15 + 5 * cmLevel; }
function coldDmgMultiplier(monsterColdResist, cmLevel, pierceCold = 0) {
  return (100 - Math.max(-100, monsterColdResist - cmResistReduction(cmLevel) - pierceCold)) / 100;
}

export function computeFcrBreakpoint(fcr) {
  return FCR_BREAKPOINTS.find(bp => fcr >= bp.minFCR) ?? FCR_BREAKPOINTS[FCR_BREAKPOINTS.length - 1];
}

export function computeFcrTooltip(fcr) {
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

export function computeFcrBadgeClass(fcr) {
  const idx = FCR_BREAKPOINTS.findIndex(bp => fcr >= bp.minFCR);
  if (idx > 0 && fcr >= FCR_BREAKPOINTS[idx - 1].minFCR - 5) return 'badge-amber';
  if (FCR_BREAKPOINTS.some(bp => bp.minFCR === fcr)) return 'badge-green';
  return 'badge-default';
}

export function computeGearTotals(getSlotStats) {
  let t = Stats.zero();
  for (const { id } of GEAR_SLOTS) t = t.add(getSlotStats(id));
  return t;
}

export function computeCombat(totals, effCM, skillData = {}) {
  const bp          = computeFcrBreakpoint(totals.fcr);
  const skillBonus  = totals.allSkills + totals.coldSkills;
  const blizzSlvl    = SKILL_HARD_PTS['Blizzard']  + skillBonus;
  const iceBlastSlvl = SKILL_HARD_PTS['Ice Blast']  + skillBonus;
  const iceBlastCasts = iceBlastsPerWindow(bp.frames);

  const blizzDat    = skillData['Blizzard'];
  const iceBlastDat = skillData['Ice Blast'];

  if (!blizzDat || !iceBlastDat) return null;

  const coldDmgMult = 1 + (totals.coldDmgPct || 0) / 100;

  function synergyMult(dat) {
    const rate = (dat.synergy_pct_per_level ?? 0) / 100;
    const totalBlvl = (dat.synergy_skills ?? []).reduce(
      (sum, sk) => sum + (SKILL_HARD_PTS[sk] ?? 0), 0
    );
    return 1 + rate * totalBlvl;
  }

  const blizzPerShard = calcSkillAvgBase(blizzSlvl, blizzDat) * synergyMult(blizzDat) * coldDmgMult;
  const blizzDmg      = BLIZZARD_BOLTS_VS_BOSS * blizzPerShard;
  const iceBlastDmg   = calcSkillAvgBase(iceBlastSlvl, iceBlastDat) * synergyMult(iceBlastDat) * coldDmgMult;
  const blizzDps      = blizzDmg / BLIZZARD_COOLDOWN_SECS;
  const iceBlastDps   = iceBlastCasts * iceBlastDmg / BLIZZARD_COOLDOWN_SECS;
  return { effCM, bp, blizzDps, iceBlastDps, totalDps: blizzDps + iceBlastDps,
    blizzDmg, blizzPerShard, iceBlastDmg, blizzSlvl, iceBlastSlvl,
    iceBlastCasts, enemyColdResPct: totals.enemyColdResPct || 0 };
}

export function computeCombatAssumptions(_combat) {
  return `Assumes:\n- Standard blizz sorc build\n- All Blizzard shards hit the target\n- ~${ICE_BLAST_HIT_RATE * 100}% of Ice Blasts hit the target`;
}

function fmtMonsterId(id) {
  return id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function computeRunStats(combat, runConfigData, runConfigMeta, monsterDbData, runBosses) {
  const { bp, effCM, blizzDmg, iceBlastDmg, iceBlastCasts } = combat;
  const actOverhead = runConfigMeta.act_overhead_secs ?? {};
  const stats = {};
  for (const run of runConfigData) {
    if (!run.available) continue;
    const travelSecs = (run.teleports ?? 0) * bp.frames / D2_FPS;
    let killSecs = 0;
    const monCombat = monsterDbData?.monsters?.[run.id]?.combat ?? {};

    const pierceCold = combat.enemyColdResPct ?? 0;
    if (runBosses[run.id] && monCombat.hp) {
      const mult   = coldDmgMultiplier(monCombat.cold_resist ?? 0, effCM, pierceCold);
      const effDps = (blizzDmg / BLIZZARD_COOLDOWN_SECS + iceBlastCasts * iceBlastDmg / BLIZZARD_COOLDOWN_SECS) * mult;
      const amount = (run.monsters ?? []).reduce((s, m) => s + (m.amount ?? 1), 0) || 1;
      killSecs = (monCombat.hp / effDps) * amount;
    }

    const travelDetail = `~${run.teleports ?? 0} teleports × ${bp.frames} frames/cast ÷ ${D2_FPS} FPS = ${travelSecs.toFixed(1)}s`;

    let killDetail = null;
    if (monCombat.hp) {
      const monResist  = monCombat.cold_resist ?? 0;
      const cmRed      = cmResistReduction(effCM);
      const effRes     = Math.max(-100, monResist - cmRed - pierceCold);
      const mult       = coldDmgMultiplier(monResist, effCM, pierceCold);
      const pierceLine = pierceCold ? ` − Enemy CR Pierce ${pierceCold}%` : '';
      killDetail = [
        `HP: ${monCombat.hp.toLocaleString()}`,
        `Cold resist: ${monResist}% − Cold Mastery lv ${effCM} (−${cmRed}%)${pierceLine} → eff. resist: ${effRes}% → ${mult.toFixed(2)}× damage multiplier`,
      ].join('\n');
    }

    const monsterLines = (run.monsters ?? []).map(m =>
      `${fmtMonsterId(m.monster_id ?? m.id)} ×${m.amount ?? 1}`
    );
    const assumptions = [
      `~${run.teleports ?? 0} teleports to reach`,
      monsterLines.length ? `Kills: ${monsterLines.join(', ')}` : null,
    ].filter(Boolean).join('\n');

    const overheadSecs = actOverhead[run.act] ?? 0;
    stats[run.id] = { travelSecs, killSecs, overheadSecs, totalSecs: travelSecs + killSecs + overheadSecs,
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

export function computeEttvd(totalRunSecs, totalDropProbsData) {
  if (!totalRunSecs || !totalDropProbsData) return null;
  const p = totalDropProbsData;
  const secs = (prob) => prob > 0 ? totalRunSecs / prob : null;
  return { total: secs(p.total), items: secs(p.itemProb), rune: secs(p.runeProb),
    skiller: secs(p.skillerProb), valueSc: secs(p.valuableScProb) };
}

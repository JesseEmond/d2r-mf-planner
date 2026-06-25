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

// Pack combat model: blizzard-only coverage across a group of monsters
const PACK_HERD_SECS       = 0.5;  // flat time to herd pack together
const PACK_STRAGGLER_SECS  = 1.0;  // flat cleanup after main kill
const PACK_BLIZZ_HITS_PER_SEC = 2.0; // avg blizzard shards landing per second across the group

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
  return [
    'Assumes:',
    `- Single isolated monster (no minions): ${BLIZZARD_BOLTS_VS_BOSS} Blizzard shards hit the target; ~${ICE_BLAST_HIT_RATE * 100}% of Ice Blasts land`,
    `- Multi-monster packs (boss + minions, or groups): ${PACK_HERD_SECS}s herd + Blizzard at ~${PACK_BLIZZ_HITS_PER_SEC} shards/sec across the group + ${PACK_STRAGGLER_SECS}s straggler cleanup; Ice Blast not used`,
    `- Elite packs (champion/unique groups): no herd or straggler overhead — kill time only`,
    '- Cold-immune monsters fully skipped (kill time + drops) unless a Cold Sunder charm is equipped',
    '- Pack minions use boss cold resist; no cold immunity roll applied to minions; minion drops counted separately (always killable)',
  ].join('\n');
}

function fmtP(p) {
  if (!p || p <= 0) return 'N/A';
  return `1 in ${Math.round(1 / p).toLocaleString()}`;
}

function fmtMonDrop(m, key) {
  if (m.skipped) return 'skipped (cold immune, no sunder)';
  return fmtP(m[key]);
}

export function formatDropDetail(packDetails, key) {
  if (!packDetails?.length) return '';
  if (packDetails.length === 1 && packDetails[0].monsters.length === 1) {
    const m = packDetails[0].monsters[0];
    return `${m.label}: ${fmtMonDrop(m, key)}`;
  }
  const lines = [];
  for (const pack of packDetails) {
    const spawnNote = pack.spawnProb < 1 ? ` (${Math.round(pack.spawnProb * 100)}%)` : '';
    if (pack.monsters.length === 1) {
      const m = pack.monsters[0];
      lines.push(`${m.label}${spawnNote}: ${fmtMonDrop(m, key)}`);
    } else {
      const bosses  = pack.monsters.filter(m => !m.is_minion);
      const minions = pack.monsters.filter(m =>  m.is_minion);
      const minionCount = minions.reduce((s, m) => s + (m.amount ?? 1), 0);
      const packName = bosses.map(m => m.label).join(', ')
        + (minionCount > 0 ? ` + ${minionCount} minion${minionCount !== 1 ? 's' : ''}` : '');
      lines.push(`${packName}${spawnNote}`);
      for (const m of pack.monsters) {
        lines.push(`  ${m.label}: ${fmtMonDrop(m, key)}`);
      }
    }
  }
  return lines.join('\n');
}


export function computeRunStats(combat, runConfigData, runConfigMeta, monsterDbData, runBosses, hasColdSunder) {
  const { bp, effCM, blizzDmg, blizzPerShard, iceBlastDmg, iceBlastCasts } = combat;
  const actOverhead = runConfigMeta.act_overhead_secs ?? {};
  const stats = {};

  for (const run of runConfigData) {
    if (!run.available) continue;
    const teleportsTo = run.teleports_to ?? run.teleports ?? 0;
    const teleportsBack = run.teleports_back ?? 0;
    const totalTeleports = teleportsTo + teleportsBack;
    const travelSecs = totalTeleports * bp.frames / D2_FPS;
    const teleportBreakdown = teleportsBack > 0
      ? `~${teleportsTo} to reach + ${teleportsBack} to leave = ${totalTeleports} total`
      : `~${totalTeleports}`;
    const travelDetail = `${teleportBreakdown} teleports × ${bp.frames} frames/cast ÷ ${D2_FPS} FPS = ${travelSecs.toFixed(1)}s`;
    const allPacks = monsterDbData?.runs?.[run.id]?.monster_packs ?? [];
    const packs = allPacks.filter(p => !p.room_pack || run.kill_room_packs !== false);
    const pierceCold = combat.enemyColdResPct ?? 0;

    let killSecs = 0;
    const killLines = [];

    if (runBosses[run.id] && packs.length > 0) {
      for (const pack of packs) {
        const packMonsters = pack.monsters ?? [];
        const namedMonsters = packMonsters.filter(m => !m.is_minion);
        // Single iff the pack is exactly one monster with no minions — any pack with minions
        // uses multi-monster logic so all HP is counted.
        const isSingle = packMonsters.length === 1 && (packMonsters[0].amount ?? 1) === 1;
        const pct = Math.round(pack.probability * 100);
        const spawnTag = pct < 100 ? ` (${pct}% spawn)` : '';

        if (isSingle) {
          // Single isolated monster (no minions): Blizzard + Ice Blast; cold immune → skip unless sundered
          const m = namedMonsters[0];
          const monCombat = monsterDbData.monsters?.[m.id]?.combat ?? {};
          if (monCombat.hp) {
            const rawImmune = monCombat.p_cold_immune ?? 0;
            const pImmune   = hasColdSunder ? 0 : rawImmune;
            const mult      = coldDmgMultiplier(monCombat.cold_resist ?? 0, effCM, pierceCold);
            const effDps    = (blizzDmg / BLIZZARD_COOLDOWN_SECS + iceBlastCasts * iceBlastDmg / BLIZZARD_COOLDOWN_SECS) * mult;
            const baseKill  = effDps > 0 ? monCombat.hp / effDps : 0;
            killSecs += pack.probability * (1 - pImmune) * baseKill;

            const monResist  = monCombat.cold_resist ?? 0;
            const cmRed      = cmResistReduction(effCM);
            const effRes     = Math.max(-100, monResist - cmRed - pierceCold);
            const pierceLine = pierceCold ? ` − Pierce ${pierceCold}%` : '';
            const immuneLine = rawImmune > 0
              ? hasColdSunder
                ? `  Cold immunity: ${(rawImmune * 100).toFixed(1)}% base chance — sundered, always killable`
                : `  Cold immunity: ${(rawImmune * 100).toFixed(1)}% chance — skipped if immune`
              : null;
            const alwaysSkipped = pImmune === 1;
            killLines.push([
              `${m.label}${spawnTag}`,
              `  HP: ${monCombat.hp.toLocaleString()} · CR: ${monResist}% − CM(−${cmRed}%)${pierceLine} → ${effRes}% → ${mult.toFixed(2)}× dmg`,
              immuneLine,
              alwaysSkipped
                ? `  skipped (cold immune, no sunder)`
                : `  Expected kill: ${(baseKill * (1 - pImmune) * pack.probability).toFixed(1)}s`,
            ].filter(Boolean).join('\n'));
          }
        } else {
          // Multi-monster pack: herd + blizzard throughput + stragglers.
          // Blizzard hits all monsters simultaneously, so kill time is driven by the
          // hardest single monster (max effHP), not the sum of all HP.
          // Cold-immune named monsters skipped unless sundered; minions use boss CR, never immune.
          let maxEffHP = 0;
          let maxEffHPLabel = '';
          const packDetailLines = [];

          for (const m of packMonsters) {
            if (m.is_minion) {
              const bossId     = m.id.replace(/_minion$/, '');
              const bossCombat = monsterDbData.monsters?.[bossId]?.combat ?? {};
              const minionMult = coldDmgMultiplier(bossCombat.cold_resist ?? 0, effCM, pierceCold);
              const effHP      = minionMult > 0 ? (m.hp ?? 0) / minionMult : 0;
              if (effHP > maxEffHP) { maxEffHP = effHP; maxEffHPLabel = m.label; }
              packDetailLines.push(`  ${m.label}${m.amount > 1 ? ` ×${m.amount}` : ''}: HP ${(m.hp ?? 0).toLocaleString()} (uses boss CR, no CI)`);
            } else {
              const monCombat  = monsterDbData.monsters?.[m.id]?.combat ?? {};
              if (!monCombat.hp) continue;
              const rawImmune  = monCombat.p_cold_immune ?? 0;
              const pImmune    = hasColdSunder ? 0 : rawImmune;
              const mult       = coldDmgMultiplier(monCombat.cold_resist ?? 0, effCM, pierceCold);
              const amount     = m.amount ?? 1;
              const effHP      = mult > 0 ? (1 - pImmune) * monCombat.hp / mult : 0;
              if (effHP > maxEffHP) { maxEffHP = effHP; maxEffHPLabel = m.label; }
              const monResist  = monCombat.cold_resist ?? 0;
              const effRes     = Math.max(-100, monResist - cmResistReduction(effCM) - pierceCold);
              const immuneNote = rawImmune > 0
                ? hasColdSunder
                  ? `, CI ${(rawImmune * 100).toFixed(1)}% (sundered)`
                  : `, CI ${(rawImmune * 100).toFixed(1)}% → ${((1 - rawImmune) * 100).toFixed(1)}% eff.`
                : '';
              packDetailLines.push(`  ${m.label}${amount > 1 ? ` ×${amount}` : ''}: HP ${monCombat.hp.toLocaleString()}, CR ${monResist}%→${effRes}%${immuneNote}`);
            }
          }

          const throughput    = blizzPerShard * PACK_BLIZZ_HITS_PER_SEC;
          // Elite packs (champion/unique groups) need no herding or straggler cleanup.
          const herdSecs      = pack.elite_group ? 0 : PACK_HERD_SECS;
          const stragglerSecs = pack.elite_group ? 0 : PACK_STRAGGLER_SECS;
          const killTime      = maxEffHP > 0 ? herdSecs + maxEffHP / throughput + stragglerSecs : 0;
          killSecs += pack.probability * killTime;

          const namedNames = namedMonsters.map(m => `${m.label}${(m.amount ?? 1) > 1 ? ` ×${m.amount}` : ''}`).join(', ');
          const overheadDetail = pack.elite_group
            ? `${(maxEffHP / throughput).toFixed(1)}s kill (bottleneck: ${maxEffHPLabel})`
            : `${herdSecs}s herd + ${(maxEffHP / throughput).toFixed(1)}s kill (bottleneck: ${maxEffHPLabel}) + ${stragglerSecs}s stragglers`;
          killLines.push([
            `Pack${spawnTag}: ${namedNames}`,
            ...packDetailLines,
            `  ${overheadDetail} = ${killTime.toFixed(1)}s (expected: ${(killTime * pack.probability).toFixed(1)}s)`,
          ].join('\n'));
        }
      }
    }

    const killDetail = killLines.length > 0 ? killLines.join('\n\n') : null;

    // Run assumptions tooltip: list packs with monster composition
    const packSummaryLines = packs.map(pack => {
      const named = (pack.monsters ?? []).filter(m => !m.is_minion);
      const minionMap = Object.fromEntries(
        (pack.monsters ?? []).filter(m => m.is_minion).map(m => [m.id, m.amount])
      );
      const names = named.map(m => {
        const minionAmt = minionMap[m.id + '_minion'];
        return `${m.label}${(m.amount ?? 1) > 1 ? ` ×${m.amount}` : ''}` + (minionAmt ? ` + ${minionAmt} minions` : '');
      });
      const prob = Math.round(pack.probability * 100);
      return `  · ${names.join(', ')}` + (prob < 100 ? ` (${prob}%)` : '');
    });
    const assumptions = [
      teleportsBack > 0
        ? `~${teleportsTo} teleports to reach, ~${teleportsBack} to leave`
        : `~${totalTeleports} teleports to reach`,
      packs.length > 0 ? 'Packs:\n' + packSummaryLines.join('\n') : null,
    ].filter(Boolean).join('\n');

    const overheadSecs = actOverhead[run.act] ?? 0;
    stats[run.id] = {
      travelSecs, killSecs, overheadSecs, totalSecs: travelSecs + killSecs + overheadSecs,
      hasKillData: killSecs > 0, assumptions, travelDetail, killDetail,
    };
  }
  return stats;
}

export function computeRunDropProbs(mf, runConfigData, monsterDbData, runBosses, valuableSet, hasColdSunder) {
  const uMF = effUniqueMF(mf);
  const sMF = effSetMF(mf);
  const result = {};

  for (const run of runConfigData) {
    if (!run.available || !runBosses[run.id]) continue;
    const allPacks = monsterDbData?.runs?.[run.id]?.monster_packs ?? [];
    const packs = allPacks.filter(p => !p.room_pack || run.kill_room_packs !== false);
    if (packs.length === 0) continue;

    // Compound no-valuable probability across all packs.
    // For a pack with spawn probability p:
    //   P(no valuable) *= 1 - p × P(at least one valuable | pack spawned)
    // Cold-immune monsters (p_cold_immune) contribute proportionally less.
    let noValuableTotal = 1;
    let runeProb = 0;
    let skillerProb = 0;
    let valuableScProb = 0;
    const packDetails = [];

    for (const pack of packs) {
      let packNoValuable = 1;
      let packRune = 0;
      let packSkiller = 0;
      let packValueSc = 0;
      const monsterDetails = [];

      for (const m of pack.monsters ?? []) {
        // For minions, use drops_from to find the reference monster; skip if unknown
        const mon = m.is_minion
          ? (m.drops_from ? monsterDbData.monsters?.[m.drops_from] : null)
          : monsterDbData.monsters?.[m.id];
        if (!mon) continue;
        const amount        = m.amount ?? 1;
        // Minions have no cold immunity of their own — always killable (effectiveFrac=1)
        const effectiveFrac = m.is_minion ? 1 : (hasColdSunder ? 1 : 1 - (mon.combat?.p_cold_immune ?? 0));

        let monNoValuable = 1;
        for (const [name, item] of Object.entries(mon.drops)) {
          if (!valuableSet.has(name)) continue;
          const qp   = item.quality_params;
          const mfV  = qp.quality_type === 'set' ? sMF : uMF;
          const prob = item.base_prob * qualityCheckProb(qp, mon.mlvl, mfV) * (item.unique_weight / item.unique_total_weight);
          // Math.pow supports fractional amounts (e.g. 2.5 for averaged champion/unique packs).
          const pNone = Math.pow(1 - effectiveFrac * prob, amount);
          monNoValuable  *= pNone;
          packNoValuable *= pNone;
        }
        const monRune     = (mon.good_rune_prob ?? 0) * amount * effectiveFrac;
        const monSkiller  = (mon.gc_base_prob ?? 0) * (mon.gc_skiller_frac ?? 0) * amount * effectiveFrac;
        const monValueSc  = (mon.sc_base_prob ?? 0) * (mon.sc_valuable_frac ?? 0) * amount * effectiveFrac;
        packRune    += monRune;
        packSkiller += monSkiller;
        packValueSc += monValueSc;
        monsterDetails.push({
          label: m.label, amount, is_minion: !!m.is_minion,
          skipped: !m.is_minion && effectiveFrac === 0,
          itemProb: 1 - monNoValuable, runeProb: monRune,
          skillerProb: monSkiller,     valuableScProb: monValueSc,
        });
      }

      const p = pack.probability;
      noValuableTotal *= 1 - p * (1 - packNoValuable);
      runeProb        += p * packRune;
      skillerProb     += p * packSkiller;
      valuableScProb  += p * packValueSc;
      packDetails.push({ spawnProb: p, monsters: monsterDetails });
    }

    const itemProb = 1 - noValuableTotal;
    result[run.id] = {
      itemProb, runeProb, skillerProb, valuableScProb,
      total: 1 - (1 - itemProb) * (1 - runeProb) * (1 - skillerProb) * (1 - valuableScProb),
      packDetails,
    };
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

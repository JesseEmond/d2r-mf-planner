import { createApp, defineComponent, reactive, computed, watch, ref, onMounted, onUnmounted } from './vendor/vue.esm-browser.prod.js';
import { GEAR_SLOTS, BLIZZARD_BOLTS_VS_BOSS, Stats, effUniqueMF, effSetMF, computeFcrBreakpoint, computeFcrTooltip, computeFcrBadgeClass, computeGearTotals, computeCombat, computeCombatAssumptions, computeRunStats, computeRunDropProbs, aggregateDropProbs, computeEttvd, formatDropDetail } from './engine.js';

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_BOSSES = { andy: true, meph: true };

const CUSTOM_ITEM   = { id: 'custom', name: 'Custom / Other', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0, coldDmgPct: 0, enemyColdResPct: 0 };
const CUSTOM_CHARM  = { id: 'custom', name: 'Custom / Other', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0, coldDmgPct: 0, enemyColdResPct: 0, unique: false };
const CUSTOM_SOCKET = { id: 'custom', name: 'Custom / Other' };

const PRESET_ITEMS = ref({});
const TARGET_GEAR_PRESETS = ref([]);
const SET_LEVEL_BONUSES = ref({});
const SET_SIZES = ref({});
const SOCKET_ITEMS = ref([]);

// ── State helpers ──────────────────────────────────────────────────────────

function makeSlot() {
  return { preset: null, sockets: [], custom: { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0, coldDmgPct: 0, enemyColdResPct: 0 } };
}

function makeCharmEntry() {
  return { preset: null, count: 1, custom: { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0, coldDmgPct: 0, enemyColdResPct: 0 } };
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

function buildStateObject(state) {
  const gear = {};
  for (const { id } of GEAR_SLOTS) {
    if (id === 'charms') continue;
    const slot = state.gear[id];
    if (slot.preset !== null || (slot.sockets ?? []).some(s => s.preset)) {
      const entry = { p: slot.preset };
      if (slot.preset === 'custom') {
        const c = slot.custom;
        if (c.name)            entry.n   = c.name;
        if (c.fcr)             entry.f   = c.fcr;
        if (c.mf)              entry.m   = c.mf;
        if (c.allSkills)       entry.a   = c.allSkills;
        if (c.coldSkills)      entry.cs  = c.coldSkills;
        if (c.coldDmgPct)      entry.cdp = c.coldDmgPct;
        if (c.enemyColdResPct) entry.ecr = c.enemyColdResPct;
      }
      const sk = (slot.sockets ?? []).filter(s => s.preset).map(s => {
        if (s.preset === 'custom') {
          const c = s.custom ?? {};
          const obj = { p: 'custom' };
          if (c.name)            obj.n   = c.name;
          if (c.fcr)             obj.f   = c.fcr;
          if (c.mf)              obj.m   = c.mf;
          if (c.allSkills)       obj.a   = c.allSkills;
          if (c.coldSkills)      obj.cs  = c.coldSkills;
          if (c.coldDmgPct)      obj.cdp = c.coldDmgPct;
          if (c.enemyColdResPct) obj.ecr = c.enemyColdResPct;
          return obj;
        }
        return s.preset;
      });
      if (sk.length) entry.sk = sk;
      gear[id] = entry;
    }
  }
  const charmEntries = state.gear.charms
    .filter(c => c.preset !== null)
    .map(c => {
      const entry = { p: c.preset };
      if (c.preset === 'custom') {
        const cu = c.custom;
        if (cu.name)            entry.n   = cu.name;
        if (cu.fcr)             entry.f   = cu.fcr;
        if (cu.mf)              entry.m   = cu.mf;
        if (cu.allSkills)       entry.a   = cu.allSkills;
        if (cu.coldSkills)      entry.cs  = cu.coldSkills;
        if (cu.coldDmgPct)      entry.cdp = cu.coldDmgPct;
        if (cu.enemyColdResPct) entry.ecr = cu.enemyColdResPct;
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
  if (state.targetPresetId !== DEFAULT_TARGET_PRESET_ID) out.tp = state.targetPresetId;
  return out;
}

async function encodeState(state) {
  const out = buildStateObject(state);
  if (!Object.keys(out).length) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(out));
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  let binary = '';
  for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
  return '.' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function decodeState(encoded, state) {
  try {
    let out;
    if (encoded.startsWith('.')) {
      const b64 = encoded.slice(1).replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '=='.slice(0, (4 - b64.length % 4) % 4);
      const raw = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(raw);
      writer.close();
      const decompressed = await new Response(ds.readable).arrayBuffer();
      out = JSON.parse(new TextDecoder().decode(decompressed));
    } else {
      out = JSON.parse(atob(encoded));
    }
    if (out.gear) {
      for (const { id } of GEAR_SLOTS) {
        if (id === 'charms') continue;
        if (out.gear[id]) {
          const e = out.gear[id];
          state.gear[id].preset = e.p ?? null;
          if (e.p === 'custom') {
            state.gear[id].custom = { name: e.n ?? '', fcr: e.f ?? 0, mf: e.m ?? 0,
              allSkills: e.a ?? 0, coldSkills: e.cs ?? 0, coldDmgPct: e.cdp ?? 0, enemyColdResPct: e.ecr ?? 0 };
          }
          if (e.sk) {
            state.gear[id].sockets = e.sk.map(p => {
              if (typeof p === 'object' && p.p === 'custom') {
                return { preset: 'custom', custom: { name: p.n ?? '', fcr: p.f ?? 0, mf: p.m ?? 0,
                  allSkills: p.a ?? 0, coldSkills: p.cs ?? 0, coldDmgPct: p.cdp ?? 0, enemyColdResPct: p.ecr ?? 0 } };
              }
              return { preset: p };
            });
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
            allSkills: e.a ?? 0, coldSkills: e.cs ?? 0, coldDmgPct: e.cdp ?? 0, enemyColdResPct: e.ecr ?? 0 };
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
    if (out.tp) state.targetPresetId = out.tp;
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

function socketItemStats(sock, slotId) {
  if (!sock.preset) return Stats.zero();
  if (sock.preset === 'custom') return Stats.from(sock.custom ?? {});
  const item = SOCKET_ITEMS.value.find(si => si.id === sock.preset);
  if (!item) return Stats.zero();
  if (item.slot_stats) {
    const ss = item.slot_stats[slotId] ?? item.slot_stats['default'] ?? {};
    return Stats.from(ss);
  }
  return Stats.from(item);
}

function slotStats(slot, slotId = '') {
  let base = null;
  if (!slot.preset) {
    // no item
  } else if (slot.preset === 'custom') {
    const setMatch = findSetItemByName(slot.custom.name?.trim());
    base = setMatch
      ? { ...slot.custom, set_name: setMatch.set_name, set_bonuses: setMatch.set_bonuses }
      : slot.custom;
  } else {
    for (const presets of Object.values(PRESET_ITEMS.value)) {
      const item = presets.find(p => p.id === slot.preset);
      if (item) { base = item; break; }
    }
  }

  const sockStats = (slot.sockets ?? []).reduce(
    (t, s) => t.add(socketItemStats(s, slotId)), Stats.zero()
  );

  if (!base) return sockStats;
  return { ...base, ...Stats.from(base).add(sockStats) };
}

function singleCharmStats(charm) {
  if (!charm.preset) return Stats.zero();
  const presets = PRESET_ITEMS.value['charms'] ?? [];
  if (charm.preset === 'custom') {
    const name = charm.custom?.name?.trim();
    const isUnique = !!(name && presets.find(p => p.unique && p.name === name));
    return Stats.from(charm.custom).scale(isUnique ? 1 : (charm.count ?? 1));
  }
  const item = presets.find(p => p.id === charm.preset);
  if (!item) return Stats.zero();
  return Stats.from(item).scale(item.unique ? 1 : (charm.count ?? 1));
}

function charmSlotStats(charmsArray) {
  return charmsArray.reduce((t, charm) => t.add(singleCharmStats(charm)), Stats.zero());
}

function charmSunder(charm) {
  if (!charm.preset) return null;
  const presets = PRESET_ITEMS.value['charms'] ?? [];
  if (charm.preset === 'custom') {
    const name = charm.custom?.name?.trim();
    return presets.find(p => p.unique && p.name === name)?.sunder ?? null;
  }
  return presets.find(p => p.id === charm.preset)?.sunder ?? null;
}

// ── Reactive state ─────────────────────────────────────────────────────────

const state = reactive(makeDefaultState());

const stateError = ref(null);

// URL state decoded asynchronously before mount — see IIFE at bottom of file

// ── Shared data refs (populated via onMounted fetch) ───────────────────────

const runConfig    = ref([]);
const runConfigMeta = ref({});

const runsByAct = computed(() => {
  const seen = new Map();
  for (const run of runConfig.value) {
    const act = run.act ?? 0;
    if (!seen.has(act)) seen.set(act, []);
    seen.get(act).push(run);
  }
  return Array.from(seen.entries()).sort(([a], [b]) => a - b).map(([act, runs]) => ({ act, runs }));
});
const monsterDb = ref(null);
const skillData  = ref({});

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

  let statsTotal = Stats.zero();
  const activeSets = [];

  for (const [setName, { count, items }] of Object.entries(sets)) {
    if (count < 2) continue;
    let setStats = Stats.zero();
    for (const item of items) {
      for (const b of (item.set_bonuses ?? [])) {
        if (b.pieces <= count) setStats = setStats.add(b);
      }
    }
    for (const b of (SET_LEVEL_BONUSES.value[setName] ?? [])) {
      if (b.pieces <= count) setStats = setStats.add(b);
    }
    statsTotal = statsTotal.add(setStats);
    const total = SET_SIZES.value[setName] ?? count;
    activeSets.push({ name: setName, pieces: count, total, stats: setStats });
  }

  return { stats: statsTotal, activeSets };
}

function makeBuild(getSlotStats) {
  const setBonuses   = computed(() => computeSetBonuses(getSlotStats));
  const gearTotals   = computed(() =>
    computeGearTotals(getSlotStats).add(setBonuses.value.stats)
  );

  const totalFCR             = computed(() => gearTotals.value.fcr);
  const totalMF              = computed(() => gearTotals.value.mf);
  const totalAllSkills       = computed(() => gearTotals.value.allSkills);
  const totalColdSkills      = computed(() => gearTotals.value.coldSkills);
  const totalColdDmgPct      = computed(() => gearTotals.value.coldDmgPct);
  const totalEnemyColdResPct = computed(() => gearTotals.value.enemyColdResPct);
  const effectiveColdMastery = computed(() =>
    state.coldMasteryBase + totalAllSkills.value + totalColdSkills.value
  );

  const fcrBreakpoint = computed(() => computeFcrBreakpoint(totalFCR.value));
  const fcrTooltip    = computed(() => computeFcrTooltip(totalFCR.value));
  const fcrBadgeClass = computed(() => computeFcrBadgeClass(totalFCR.value));

  const combat = computed(() => computeCombat(gearTotals.value, effectiveColdMastery.value, skillData.value));
  const blizzDps          = computed(() => combat.value?.blizzDps ?? null);
  const iceBlastDps       = computed(() => combat.value?.iceBlastDps ?? null);
  const totalDps          = computed(() => combat.value?.totalDps ?? null);
  const combatAssumptions = computed(() => combat.value ? computeCombatAssumptions(combat.value) : '');
  const blizzTooltip    = computed(() => combat.value
    ? `Blizzard Lv ${combat.value.blizzSlvl} — ${Math.round(combat.value.blizzPerShard).toLocaleString()} avg damage per shard (×${BLIZZARD_BOLTS_VS_BOSS} shards for single isolated targets; ~2 shards/sec for packs)`
    : 'Loading…');
  const iceBlastTooltip = computed(() => combat.value
    ? `Ice Blast Lv ${combat.value.iceBlastSlvl} — ${Math.round(combat.value.iceBlastDmg).toLocaleString()} damage per cast (single targets only; ~80% hit rate assumed)`
    : 'Loading…');

  const runStats = computed(() => {
    if (!runConfig.value.length || !monsterDb.value || !combat.value) return {};
    const hasColdSunder = state.gear.charms.some(c => charmSunder(c) === 'cold');
    return computeRunStats(combat.value, runConfig.value, runConfigMeta.value, monsterDb.value, state.run.bosses, hasColdSunder);
  });

  const runDropProbs = computed(() => {
    if (!monsterDb.value) return {};
    const hasColdSunder = state.gear.charms.some(c => charmSunder(c) === 'cold');
    const valuableSet = new Set(monsterDb.value.valuables);
    return computeRunDropProbs(totalMF.value, runConfig.value, monsterDb.value, state.run.bosses, valuableSet, hasColdSunder);
  });

  const totalDropProbs = computed(() => aggregateDropProbs(runDropProbs.value));

  const ettvd = computed(() =>
    computeEttvd(runTimeSummary.value?.total, totalDropProbs.value)
  );

  const runTimeSummary = computed(() => {
    let travel = 0, kill = 0, overhead = 0;
    for (const [id, s] of Object.entries(runStats.value)) {
      if (!state.run.bosses[id]) continue;
      travel   += s.travelSecs;
      kill     += s.killSecs;
      overhead += s.overheadSecs;
    }
    overhead += runConfigMeta.value.game_creation_secs ?? 0;
    const total = travel + kill + overhead;
    return total > 0 ? { travel, kill, overhead, total } : null;
  });

  const activeSetBonuses = computed(() => setBonuses.value.activeSets);

  return {
    totalFCR, totalMF, totalAllSkills, totalColdSkills, totalColdDmgPct, totalEnemyColdResPct,
    effectiveColdMastery, fcrBreakpoint, fcrTooltip, fcrBadgeClass,
    blizzDps, iceBlastDps, totalDps, combatAssumptions, blizzTooltip, iceBlastTooltip,
    runStats, runDropProbs, totalDropProbs, ettvd, runTimeSummary,
    activeSetBonuses,
  };
}

// ── Build instances ────────────────────────────────────────────────────────

const currentBuild = makeBuild((slotId) =>
  slotId === 'charms' ? charmSlotStats(state.gear.charms) : slotStats(state.gear[slotId], slotId)
);

const usedUniqueSocketIds = computed(() => {
  const used = new Set();
  for (const { id } of GEAR_SLOTS) {
    if (id === 'charms') continue;
    for (const sock of (state.gear[id].sockets ?? [])) {
      if (!sock.preset) continue;
      if (sock.preset === 'custom') {
        const name = sock.custom?.name?.trim();
        if (name) {
          const matched = SOCKET_ITEMS.value.find(si => si.unique && si.name === name);
          if (matched) used.add(matched.id);
        }
      } else {
        const item = SOCKET_ITEMS.value.find(si => si.id === sock.preset);
        if (item?.unique) used.add(sock.preset);
      }
    }
  }
  return used;
});

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

function getTargetSlotSockets(slotId) {
  const preset = targetPreset.value;
  if (!preset) return [];
  const sockIds = preset.sockets[slotId] ?? [];
  return sockIds.map(id => SOCKET_ITEMS.value.find(si => si.id === id)).filter(Boolean);
}

function getTargetSlotSocketStats(slotId) {
  return getTargetSlotSockets(slotId).reduce(
    (t, si) => t.add(socketItemStats({ preset: si.id }, slotId)), Stats.zero()
  );
}

function getTargetCharmStats() {
  const preset = targetPreset.value;
  if (!preset || !preset.charms?.length) return Stats.zero();
  const charmItems = PRESET_ITEMS.value['charms'] ?? [];
  return preset.charms.reduce((t, { id, count }) => {
    const item = charmItems.find(p => p.id === id);
    return item ? t.add(Stats.from(item).scale(count ?? 1)) : t;
  }, Stats.zero());
}

const targetPresetCharms = computed(() => {
  const preset = targetPreset.value;
  if (!preset || !preset.charms?.length) return [];
  const charmItems = PRESET_ITEMS.value['charms'] ?? [];
  return preset.charms.map(({ id, count }) => {
    const item = charmItems.find(p => p.id === id);
    const n = count ?? 1;
    return { id, name: item?.name ?? id, count: n, item, stats: Stats.from(item).scale(n) };
  });
});

const gearSunders = computed(() =>
  [...new Set(state.gear.charms.map(charmSunder).filter(Boolean))]
);

const targetSunders = computed(() =>
  [...new Set(targetPresetCharms.value.map(c => c.item?.sunder).filter(Boolean))]
);

const targetSlots = computed(() => {
  const out = {};
  for (const { id } of GEAR_SLOTS) {
    const item = getTargetSlotItem(id);
    const sockets = getTargetSlotSockets(id);
    const sockStats = getTargetSlotSocketStats(id);
    out[id] = { item, sockets, stats: Stats.from(item).add(sockStats) };
  }
  return out;
});

const targetBuild = makeBuild((slotId) => {
  if (slotId === 'charms') return getTargetCharmStats();
  const item = getTargetSlotItem(slotId);
  const sockStats = getTargetSlotSocketStats(slotId);
  if (!item) return sockStats;
  return { ...item, ...Stats.from(item).add(sockStats) };
});

// ── URL sync ───────────────────────────────────────────────────────────────

watch(state, async () => {
  const encoded = await encodeState(state);
  history.replaceState(null, '', encoded ? `?s=${encoded}` : location.pathname);
}, { deep: true });

// ── TooltipPopup component ─────────────────────────────────────────────────

const TooltipPopup = defineComponent({
  name: 'TooltipPopup',
  props: { text: { type: String, default: '' } },
  setup(props) {
    const visible = ref(false);
    const popupStyle = ref({});
    const wrapRef = ref(null);

    function computeStyle() {
      if (!wrapRef.value) return;
      const rect = wrapRef.value.getBoundingClientRect();
      const vw = window.innerWidth;
      const maxW = Math.min(280, vw - 16);
      let left = rect.left + rect.width / 2 - maxW / 2;
      if (left < 8) left = 8;
      if (left + maxW > vw - 8) left = vw - maxW - 8;
      const style = { position: 'fixed', left: left + 'px', maxWidth: maxW + 'px', zIndex: '9999' };
      if (rect.top > 80) {
        style.top = (rect.top - 8) + 'px';
        style.transform = 'translateY(-100%)';
      } else {
        style.top = (rect.bottom + 8) + 'px';
      }
      popupStyle.value = style;
    }

    function show() { computeStyle(); visible.value = true; }
    function hide() { visible.value = false; }
    function toggle(e) { e.stopPropagation(); visible.value ? hide() : show(); }
    function onDocClick() { if (visible.value) hide(); }

    onMounted(() => document.addEventListener('click', onDocClick));
    onUnmounted(() => document.removeEventListener('click', onDocClick));

    return { visible, popupStyle, wrapRef, show, hide, toggle };
  },
  template: `<span ref="wrapRef" class="tooltip-wrap" @mouseenter="show" @mouseleave="hide" @click.stop="toggle"><slot /><teleport to="body"><div v-if="visible && text" class="tooltip-popup" :style="popupStyle">{{ text }}</div></teleport></span>`,
});

// ── StatPills component ────────────────────────────────────────────────────

const StatPills = defineComponent({
  props: { stats: { type: Object, required: true }, sunder: { type: String, default: null } },
  template: `
    <div class="stat-pills">
      <slot />
      <tooltip-popup v-if="sunder" :text="'Sunders ' + sunder + ' immunity'"><span class="pill pill-sunder">Sunders {{ sunder }}</span></tooltip-popup>
      <tooltip-popup v-if="stats.fcr"               text="Faster Cast Rate — reduces casting animation length"><span class="pill pill-fcr">FCR +{{ stats.fcr }}%</span></tooltip-popup>
      <tooltip-popup v-if="stats.mf"                text="Magic Find — increases chance of finding magic, rare, set, and unique items"><span class="pill pill-mf">MF +{{ stats.mf }}%</span></tooltip-popup>
      <tooltip-popup v-if="stats.allSkills"          text="+All Skills — adds to all character skill levels"><span class="pill pill-skill">+{{ stats.allSkills }} All</span></tooltip-popup>
      <tooltip-popup v-if="stats.coldSkills"         text="+Cold Skills — adds to cold skill levels only"><span class="pill pill-cold">+{{ stats.coldSkills }} Cold</span></tooltip-popup>
      <tooltip-popup v-if="stats.coldDmgPct"         text="+% Cold Skill Damage — multiplies cold spell damage output"><span class="pill pill-cold-pct">Cold +{{ stats.coldDmgPct }}%</span></tooltip-popup>
      <tooltip-popup v-if="stats.enemyColdResPct"    text="Enemy Cold Resist -X% — reduces enemy cold resistance, increasing cold damage"><span class="pill pill-ecr">Enemy CR -{{ stats.enemyColdResPct }}%</span></tooltip-popup>
    </div>
  `,
});

// ── SetBonusBlock component ────────────────────────────────────────────────

const SetBonusBlock = defineComponent({
  props: { activeSets: { type: Array, required: true } },
  components: { StatPills },
  template: `
    <div v-if="activeSets.length" class="set-bonuses-block">
      <div class="set-bonuses-header">Set Bonuses</div>
      <div v-for="sb in activeSets" :key="sb.name" class="set-bonus-row">
        <div class="set-bonus-meta">
          <span class="set-bonus-name">{{ sb.name }}</span>
          <tooltip-popup :text="sb.pieces + ' of ' + sb.total + ' pieces equipped'">
            <span class="set-pips">
              <span v-for="i in sb.total" :key="i" :class="i <= sb.pieces ? 'pip pip-on' : 'pip pip-off'">{{ i <= sb.pieces ? '●' : '○' }}</span>
            </span>
          </tooltip-popup>
        </div>
        <stat-pills :stats="sb.stats" class="set-bonus-pills" />
      </div>
    </div>
  `,
});

// ── CustomItem component ───────────────────────────────────────────────────

const CustomItem = defineComponent({
  props: {
    modelValue:       { type: Object,   required: true },
    presets:          { type: Array,    required: true },
    isPresetDisabled: { type: Function, default: null  },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    const basisId = ref('');
    function update(patch) {
      emit('update:modelValue', { ...props.modelValue, ...patch });
    }
    function applyBasis() {
      const id = basisId.value;
      if (!id) return;
      const item = props.presets.find(p => p.id === id);
      if (item) {
        update({
          name:             item.name,
          fcr:              item.fcr              ?? 0,
          mf:               item.mf               ?? 0,
          allSkills:        item.allSkills        ?? 0,
          coldSkills:       item.coldSkills       ?? 0,
          coldDmgPct:       item.coldDmgPct       ?? 0,
          enemyColdResPct:  item.enemyColdResPct  ?? 0,
        });
      }
      basisId.value = '';
    }
    const realPresets = computed(() => props.presets.filter(p => p.id !== 'custom'));
    return { basisId, update, applyBasis, realPresets };
  },
  template: `
    <div class="custom-inputs">
      <select v-model="basisId" @change="applyBasis" class="custom-basis-select">
        <option value="">Start from...</option>
        <option v-for="p in realPresets" :key="p.id" :value="p.id" :disabled="isPresetDisabled?.(p) ?? false">{{ p.name }}</option>
      </select>
      <input type="text" placeholder="Name" :value="modelValue.name" @input="update({ name: $event.target.value })" class="custom-text" />
      <div class="custom-inputs-stats">
        <label :class="{ 'custom-zero': !modelValue.fcr }"><span>FCR</span><input type="number" min="0" :value="modelValue.fcr"             @input="update({ fcr:             +$event.target.value })" class="custom-num" /></label>
        <label :class="{ 'custom-zero': !modelValue.mf }"><span>MF</span><input type="number" min="0" :value="modelValue.mf"              @input="update({ mf:              +$event.target.value })" class="custom-num" /></label>
        <label :class="{ 'custom-zero': !modelValue.allSkills }"><span>+All</span><input type="number" min="0" :value="modelValue.allSkills"       @input="update({ allSkills:       +$event.target.value })" class="custom-num" /></label>
        <label :class="{ 'custom-zero': !modelValue.coldSkills }"><span>+Cold</span><input type="number" min="0" :value="modelValue.coldSkills"      @input="update({ coldSkills:      +$event.target.value })" class="custom-num" /></label>
        <label :class="{ 'custom-zero': !modelValue.coldDmgPct }"><span>Cold%</span><input type="number" min="0" :value="modelValue.coldDmgPct"      @input="update({ coldDmgPct:      +$event.target.value })" class="custom-num" /></label>
        <label :class="{ 'custom-zero': !modelValue.enemyColdResPct }"><span>ECR%</span><input type="number" min="0" :value="modelValue.enemyColdResPct" @input="update({ enemyColdResPct: +$event.target.value })" class="custom-num" /></label>
      </div>
    </div>
  `,
});

// ── GearSlot component ─────────────────────────────────────────────────────

const GearSlot = defineComponent({
  props: {
    slotId:      { type: String, required: true },
    slotLabel:   { type: String, required: true },
    presets:     { type: Array,  required: true },
    modelValue:  { type: Object, required: true },
    socketItems:          { type: Array,  default: () => [] },
    usedUniqueSocketIds:  { type: Object, default: () => new Set() },
  },
  emits: ['update:modelValue'],
  components: { StatPills, CustomItem },
  setup(props, { emit }) {
    function update(patch) {
      const next = { ...props.modelValue, ...patch };
      if ('preset' in patch) {
        if (!patch.preset) {
          next.sockets = [];
        } else if (patch.preset !== 'custom') {
          const newItem = (props.presets ?? []).find(p => p.id === patch.preset);
          if (!newItem?.max_sockets) next.sockets = [];
          next.custom = { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0, coldDmgPct: 0, enemyColdResPct: 0 };
        }
      }
      emit('update:modelValue', next);
    }
    function updateCustom(newCustom) {
      emit('update:modelValue', { ...props.modelValue, custom: newCustom });
    }

    const SOCKETABLE_SLOTS = new Set(['head', 'weapon', 'shield', 'armor']);
    const currentMaxSockets = computed(() => {
      if (!props.modelValue.preset) return 0;
      if (props.modelValue.preset === 'custom') return SOCKETABLE_SLOTS.has(props.slotId) ? 1 : 0;
      const item = (props.presets ?? []).find(p => p.id === props.modelValue.preset);
      return item?.max_sockets ?? 0;
    });

    function resolveSocketStats(sock) {
      if (!sock.preset) return Stats.zero();
      if (sock.preset === 'custom') return Stats.from(sock.custom ?? {});
      const item = (props.socketItems ?? []).find(si => si.id === sock.preset);
      if (!item) return Stats.zero();
      if (item.slot_stats) {
        const ss = item.slot_stats[props.slotId] ?? item.slot_stats['default'] ?? {};
        return Stats.from(ss);
      }
      return Stats.from(item);
    }

    function addSocket() {
      const sockets = [...(props.modelValue.sockets ?? []), { preset: null }];
      emit('update:modelValue', { ...props.modelValue, sockets });
    }
    function removeSocket(idx) {
      const sockets = [...(props.modelValue.sockets ?? [])];
      sockets.splice(idx, 1);
      emit('update:modelValue', { ...props.modelValue, sockets });
    }
    function updateSocket(idx, presetId) {
      const sockets = (props.modelValue.sockets ?? []).map((s, i) => {
        if (i !== idx) return s;
        if (!presetId) return { preset: null };
        if (presetId === 'custom') return { preset: 'custom', custom: { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0, coldDmgPct: 0, enemyColdResPct: 0 } };
        return { preset: presetId };
      });
      emit('update:modelValue', { ...props.modelValue, sockets });
    }
    function updateSocketCustom(idx, newCustom) {
      const sockets = (props.modelValue.sockets ?? []).map((s, i) =>
        i === idx ? { ...s, custom: newCustom } : s
      );
      emit('update:modelValue', { ...props.modelValue, sockets });
    }

    function stats() {
      const slot = props.modelValue;
      let base;
      if (!slot.preset || slot.preset === 'custom') {
        base = slot.custom;
      } else {
        base = (props.presets ?? []).find(p => p.id === slot.preset) ?? Stats.zero();
      }
      const sockStats = (slot.sockets ?? []).reduce(
        (t, s) => t.add(resolveSocketStats(s)), Stats.zero()
      );
      return Stats.from(base).add(sockStats);
    }

    const matchedSetItem = computed(() => {
      if (props.modelValue.preset !== 'custom') return null;
      const name = props.modelValue.custom.name?.trim();
      if (!name) return null;
      return (props.presets ?? []).find(p => p.set_name && p.name === name) ?? null;
    });
    const socketItemsForBasis = computed(() =>
      (props.socketItems ?? []).map(si => {
        if (!si.slot_stats) return si;
        const ss = si.slot_stats[props.slotId] ?? si.slot_stats['default'] ?? {};
        return { ...si, ...ss };
      })
    );

    function matchedUniqueSocketPreset(sock) {
      if (sock.preset !== 'custom') return null;
      const name = sock.custom?.name?.trim();
      if (!name) return null;
      return (props.socketItems ?? []).find(si => si.unique && si.name === name) ?? null;
    }

    function isSocketItemDisabledForBasis(si, sock) {
      if (!si.unique) return false;
      const selfMatch = matchedUniqueSocketPreset(sock);
      if (selfMatch?.id === si.id) return false;
      return props.usedUniqueSocketIds.has(si.id);
    }

    return { update, updateCustom, stats, matchedSetItem,
             currentMaxSockets, resolveSocketStats, addSocket, removeSocket, updateSocket, updateSocketCustom,
             socketItemsForBasis, matchedUniqueSocketPreset, isSocketItemDisabledForBasis };
  },
  template: `
    <div class="gear-slot">
      <div class="gear-slot-left">
        <div class="gear-slot-top">
          <label class="slot-label">{{ slotLabel }}</label>
          <select
            :value="modelValue.preset ?? ''"
            @change="update({ preset: $event.target.value || null })"
            class="slot-select"
          >
            <option value="">— none —</option>
            <option v-for="p in presets" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>

        <stat-pills v-if="modelValue.preset" :stats="stats()">
          <tooltip-popup v-if="matchedSetItem && modelValue.preset !== 'custom'" :text="'Name matches ' + matchedSetItem.set_name + ' set item — counted towards set bonus'"><span class="pill pill-set-match">Set: {{ matchedSetItem.set_name }}</span></tooltip-popup>
        </stat-pills>

        <custom-item v-if="modelValue.preset === 'custom'" :modelValue="modelValue.custom" @update:modelValue="updateCustom" :presets="presets" />

        <div v-if="modelValue.preset === 'custom' && matchedSetItem" class="custom-stat-pills">
          <tooltip-popup :text="'Name matches ' + matchedSetItem.set_name + ' set item — counted towards set bonus'"><span class="pill pill-set-match">Set: {{ matchedSetItem.set_name }}</span></tooltip-popup>
        </div>

        <div v-if="modelValue.preset && currentMaxSockets > 0" class="socket-section">
          <div v-if="(modelValue.sockets ?? []).length" class="socket-list">
            <div v-for="(sock, idx) in (modelValue.sockets ?? [])" :key="idx" class="socket-entry">
              <div class="socket-row">
                <span class="socket-label">(socket)</span>
                <select
                  :value="sock.preset ?? ''"
                  @change="updateSocket(idx, $event.target.value)"
                  class="slot-select socket-select"
                >
                  <option value="">— gem/rune —</option>
                  <option v-for="si in socketItems" :key="si.id" :value="si.id"
                    :disabled="si.unique && usedUniqueSocketIds.has(si.id) && sock.preset !== si.id"
                  >{{ si.name }}</option>
                  <option value="custom">Custom / Other</option>
                </select>
                <button @click="removeSocket(idx)" class="socket-remove">&times;</button>
              </div>
              <custom-item v-if="sock.preset === 'custom'" :modelValue="sock.custom ?? {}" @update:modelValue="updateSocketCustom(idx, $event)" :presets="socketItemsForBasis" :isPresetDisabled="si => isSocketItemDisabledForBasis(si, sock)" />
              <div v-if="sock.preset === 'custom' && matchedUniqueSocketPreset(sock)" class="charm-custom-stat-pills">
                <tooltip-popup text="Name matches a unique socketed item — treated as unique (only one allowed)"><span class="pill pill-unique-match">Unique: {{ matchedUniqueSocketPreset(sock).name }}</span></tooltip-popup>
              </div>
            </div>
          </div>
          <button
            v-if="(modelValue.sockets ?? []).length < currentMaxSockets"
            @click="addSocket"
            class="socket-add"
          >+ Socket</button>
        </div>
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
  components: { StatPills, CustomItem },
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
          updated.custom = { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0, coldDmgPct: 0, enemyColdResPct: 0 };
        }
        return updated;
      });
      emit_(next);
    }

    function updateCharmCustomFull(idx, newCustom) {
      emit_(props.modelValue.map((c, i) =>
        i === idx ? { ...c, custom: newCustom } : c
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


    function sunderLabel(charm) {
      const item = charm.preset === 'custom'
        ? matchedUniquePreset(charm)
        : (props.presets ?? []).find(p => p.id === charm.preset);
      return item?.sunder ?? null;
    }

    return { addCharm, removeCharm, updateCharm, updateCharmCustomFull, updateCharmCount, isUniqueCharm, isDisabled, singleCharmStats, sunderLabel, matchedUniquePreset };
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
            <input v-if="charm.preset && !isUniqueCharm(charm)"
              type="number" min="1"
              :value="charm.count ?? 1"
              @input="updateCharmCount(idx, +$event.target.value)"
              class="charm-count"
            />
            <div v-else-if="charm.preset" class="charm-count-spacer">× 1</div>
            <button @click="removeCharm(idx)" class="charm-remove">&times;</button>
          </div>
          <stat-pills v-if="charm.preset" :stats="singleCharmStats(charm)" :sunder="sunderLabel(charm)" />
          <custom-item v-if="charm.preset === 'custom'" :modelValue="charm.custom" @update:modelValue="updateCharmCustomFull(idx, $event)" :presets="presets" :isPresetDisabled="p => isDisabled(p, idx)" />
          <div v-if="charm.preset === 'custom' && matchedUniquePreset(charm)" class="charm-custom-stat-pills">
            <tooltip-popup text="Name matches a unique charm — treated as unique (only one allowed)"><span class="pill pill-unique-match">Unique: {{ matchedUniquePreset(charm).name }}</span></tooltip-popup>
          </div>
        </div>
      </div>
    </div>
  `,
});

// ── Shared formatting ──────────────────────────────────────────────────────

function _fmtEttvd(secs) {
  const totalMins = Math.round(secs / 60);
  if (totalMins < 60) return `${totalMins} min`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// ── TimeToValuableDropSummary component ────────────────────────────────────

const ETTVD_ROWS = [
  {
    key: 'items',
    label: 'Good Unique / Set Item',
    tooltip: 'Expected time between any item from the Maxroll Med/High trade-value list (maxroll.gg/d2/items/valuable-unique-set-items) — Shako, Oculus, Mara\'s Kaleidoscope, etc. Accounts for MF diminishing returns and the quality roll.',
  },
  {
    key: 'rune',
    label: 'Good Rune',
    tooltip: 'Expected time between any Pul+ rune drop',
  },
  {
    key: 'skiller',
    label: 'Any Skiller GC',
    tooltip: 'Expected time between any class skiller Grand Charm drop',
  },
  {
    key: 'valueSc',
    label: 'Valuable SC',
    tooltip: 'Expected time between a max-roll +5 all res, +7% MF, or +20 life Small Charm drop',
  },
];

const TimeToValuableDropSummary = defineComponent({
  props: {
    ettvd:    { default: null },
    isTarget: { type: Boolean, default: false },
  },
  setup(props) {
    const fmt = (v) => v ? _fmtEttvd(v) : '---';
    return { fmt, ETTVD_ROWS };
  },
  template: `
    <section :class="['ettvd-block', 'summary-block', isTarget && 'ettvd-block-target']">
      <h2 class="panel-title">
        <tooltip-popup :text="isTarget
          ? 'Expected Time To Valuable Drop — estimated average time until a desirable item drops, given target gear, MF, and run routine'
          : 'Expected Time To Valuable Drop — estimated average time until a desirable item drops, given your gear, MF, and run routine'"
        ><abbr>ETTVD</abbr></tooltip-popup>: Time To Valuable Drop
      </h2>
      <div :class="['ettvd-main', isTarget && 'ettvd-target', !ettvd && 'ettvd-empty']">
        {{ ettvd ? fmt(ettvd.total) : '---' }}
      </div>
      <div class="ettvd-breakdown">
        <div v-for="row in ETTVD_ROWS" :key="row.key" class="breakdown-row breakdown-sub">
          <span>{{ row.label }} <tooltip-popup :text="row.tooltip"><span class="info-icon">i</span></tooltip-popup></span>
          <span>{{ ettvd ? fmt(ettvd[row.key]) : '---' }}</span>
        </div>
      </div>
    </section>
  `,
});

// ── App ────────────────────────────────────────────────────────────────────

const app = createApp({
  components: { GearSlot, CharmsPanel, StatPills, SetBonusBlock, TimeToValuableDropSummary },
  setup() {
    onMounted(async () => {
      try {
        const [rcRes, dbRes] = await Promise.all([
          fetch('data/run_config.json', { cache: 'no-cache' }),
          fetch('data/db.json',         { cache: 'no-cache' }),
        ]);
        const [rc, db] = await Promise.all([rcRes.json(), dbRes.json()]);
        runConfig.value    = rc.runs;
        runConfigMeta.value = { act_overhead_secs: rc.act_overhead_secs ?? {}, game_creation_secs: rc.game_creation_secs ?? 0 };
        monsterDb.value = db;
        skillData.value  = db.skill_data ?? {};
        const itemsBySlot = db.gear.items_by_slot;
        for (const { id } of GEAR_SLOTS) {
          const sorted = [...(itemsBySlot[id] ?? [])].sort((a, b) => a.name.localeCompare(b.name));
          if (id === 'charms') {
            PRESET_ITEMS.value[id] = [...sorted, CUSTOM_CHARM];
          } else {
            PRESET_ITEMS.value[id] = [...sorted, CUSTOM_ITEM];
          }
        }
        SET_LEVEL_BONUSES.value = db.gear.set_level_bonuses ?? {};
        SET_SIZES.value = db.gear.set_sizes ?? {};
        SOCKET_ITEMS.value = db.gear.socket_items ?? [];
        TARGET_GEAR_PRESETS.value = Object.entries(db.gear.presets).map(
          ([id, preset]) => ({ id, name: id, slots: preset, sockets: preset.sockets ?? {}, charms: preset.charms ?? [] })
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

    // Static descriptions for each drop-odds category (defined here to keep apostrophes
    // out of Vue template expressions, where backslash escapes inside attribute strings
    // are unreliable across HTML parsers).
    const DROP_CATEGORY_DESC = {
      itemProb:      "Any item from the Maxroll Med/High trade-value list (maxroll.gg/d2/items/valuable-unique-set-items) — Shako, Oculus, Mara's Kaleidoscope, etc. Accounts for MF diminishing returns and the quality roll.",
      runeProb:      "Any rune Pul (r21) or better — tradeable for meaningful gear upgrades.",
      skillerProb:   "A magic Grand Charm with any class skill tab prefix (e.g. +1 Cold Skills, +1 Combat Skills, etc.) — all 8 classes, 3 tabs each. Accounts for magic quality roll, P(has a prefix), and the skiller affix fraction.",
      valuableScProb:"A magic Small Charm with exactly +5 all res (Shimmering), +7% MF (of Good Luck), or +20 life (of Vita). Only the max roll counts. Accounts for P(has prefix/suffix) per the magic item layout distribution.",
    };

    // Returns a tooltip string for a drop-odds category: static description followed by
    // per-pack/per-monster breakdown from packDetails.
    const _runDropProbsRef = currentBuild.runDropProbs;
    function runDropDetail(runId, key) {
      const desc  = DROP_CATEGORY_DESC[key] ?? '';
      const drops = _runDropProbsRef.value?.[runId];
      if (!drops?.packDetails) return desc;
      const detail = formatDropDetail(drops.packDetails, key);
      return detail ? `${desc}\n\n${detail}` : desc;
    }

    const showResetConfirm = ref(false);

    function resetState() {
      Object.assign(state, makeDefaultState());
      stateError.value = null;
      window.history.replaceState(null, '', window.location.pathname);
      showResetConfirm.value = false;
    }

    return {
      state,
      stateError,
      showResetConfirm,
      resetState,
      GEAR_SLOTS,
      PRESET_ITEMS,
      SOCKET_ITEMS,
      usedUniqueSocketIds,
      GROUP_A,
      GROUP_B,
      runConfig,
      runsByAct,
      runConfigMeta,
      TARGET_GEAR_PRESETS,
      targetPreset,
      targetSlots,
      fmtOneIn,
      runDropDetail,
      effUniqueMF,
      effSetMF,

      // Current build — same names as before so the template is unchanged
      activeSetBonuses:     currentBuild.activeSetBonuses,
      totalFCR:             currentBuild.totalFCR,
      totalMF:              currentBuild.totalMF,
      totalAllSkills:       currentBuild.totalAllSkills,
      totalColdSkills:      currentBuild.totalColdSkills,
      totalColdDmgPct:      currentBuild.totalColdDmgPct,
      totalEnemyColdResPct: currentBuild.totalEnemyColdResPct,
      effectiveColdMastery: currentBuild.effectiveColdMastery,
      fcrBreakpoint:        currentBuild.fcrBreakpoint,
      fcrBadgeClass:        currentBuild.fcrBadgeClass,
      fcrTooltip:           currentBuild.fcrTooltip,
      blizzDps:             currentBuild.blizzDps,
      iceBlastDps:          currentBuild.iceBlastDps,
      totalDps:             currentBuild.totalDps,
      combatAssumptions:    currentBuild.combatAssumptions,
      blizzTooltip:         currentBuild.blizzTooltip,
      iceBlastTooltip:      currentBuild.iceBlastTooltip,
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
      targetTotalColdDmgPct:      targetBuild.totalColdDmgPct,
      targetTotalEnemyColdResPct: targetBuild.totalEnemyColdResPct,
      targetEffectiveColdMastery: targetBuild.effectiveColdMastery,
      targetFcrBreakpoint:        targetBuild.fcrBreakpoint,
      targetFcrBadgeClass:        targetBuild.fcrBadgeClass,
      targetFcrTooltip:           targetBuild.fcrTooltip,
      targetBlizzDps:             targetBuild.blizzDps,
      targetIceBlastDps:          targetBuild.iceBlastDps,
      targetTotalDps:             targetBuild.totalDps,
      targetCombatAssumptions:    targetBuild.combatAssumptions,
      targetBlizzTooltip:         targetBuild.blizzTooltip,
      targetIceBlastTooltip:      targetBuild.iceBlastTooltip,
      targetRunStats:             targetBuild.runStats,
      targetRunDropProbs:         targetBuild.runDropProbs,
      targetTotalDropProbs:       targetBuild.totalDropProbs,
      targetRunTimeSummary:       targetBuild.runTimeSummary,
      targetEttvd:                targetBuild.ettvd,
      targetPresetCharms,
      gearSunders,
      targetSunders,
    };
  },
  template: `
    <div class="app-root">
      <header class="app-header sticky-header">
        <h1>D2R Blizzard Sorc — <tooltip-popup text="Expected Time To Valuable Drop — estimated average runs until a desirable item drops, given your MF and run routine"><abbr>ETTVD</abbr></tooltip-popup> Optimizer</h1>
        <button class="reset-btn" @click="showResetConfirm = true">Reset</button>
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
                :socket-items="SOCKET_ITEMS"
                :used-unique-socket-ids="usedUniqueSocketIds"
                v-model="state.gear[id]"
              />
            </div>
            <div class="slot-group">
              <gear-slot
                v-for="id in GROUP_B" :key="id"
                :slot-id="id"
                :slot-label="GEAR_SLOTS.find(s => s.id === id).label"
                :presets="PRESET_ITEMS[id] ?? []"
                :socket-items="SOCKET_ITEMS"
                :used-unique-socket-ids="usedUniqueSocketIds"
                v-model="state.gear[id]"
              />
            </div>

            <set-bonus-block :active-sets="activeSetBonuses" />

            <div class="charms-section">
              <charms-panel
                :presets="PRESET_ITEMS['charms'] ?? []"
                v-model="state.gear.charms"
              />
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title">Stats</h2>
            <div class="stat-line">
              <tooltip-popup :text="fcrTooltip"><span>FCR <span class="stat-val">{{ totalFCR }}%</span> <span class="fcr-badge" :class="fcrBadgeClass">{{ fcrBreakpoint.frames }}f</span></span></tooltip-popup>
              <tooltip-popup v-if="totalMF" text="Magic Find — increases chance of finding magic, rare, set, and unique items"><span>MF <span class="stat-val">+{{ totalMF }}%</span></span></tooltip-popup>
              <tooltip-popup v-if="totalAllSkills" text="+All Skills — adds to all character skill levels"><span>All Skills <span class="stat-val">+{{ totalAllSkills }}</span></span></tooltip-popup>
              <tooltip-popup v-if="totalColdSkills" text="+Cold Skills — adds to cold skill levels only"><span>Cold Skills <span class="stat-val">+{{ totalColdSkills }}</span></span></tooltip-popup>
              <tooltip-popup v-if="totalColdDmgPct" text="+% Cold Skill Damage — multiplies cold spell damage output"><span>Cold Damage <span class="stat-val">+{{ totalColdDmgPct }}%</span></span></tooltip-popup>
              <tooltip-popup v-if="totalEnemyColdResPct" text="Enemy Cold Resist -X% from gear — reduces enemy cold resistance, stacks with Cold Mastery"><span>Enemy CR <span class="stat-val">-{{ totalEnemyColdResPct }}%</span></span></tooltip-popup>
              <tooltip-popup v-for="s in gearSunders" :key="s" :text="'Sunders ' + s + ' immunity'"><span class="pill pill-sunder">Sunders {{ s }}</span></tooltip-popup>
              <tooltip-popup text="Cold Mastery — reduces enemy cold resistance; effective level includes +All Skills and +Cold Skills from gear"><span>Cold Mastery <span class="stat-val">Lv {{ effectiveColdMastery }}</span></span></tooltip-popup>
            </div>
            <div class="cm-input-row">
              <label class="cm-label">
                Cold Mastery base pts (0–20)
                <input type="number" min="0" max="20" v-model.number="state.coldMasteryBase" class="custom-num" />
                <span class="cm-breakdown">(+{{ totalAllSkills + totalColdSkills }} from gear)</span>
              </label>
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title">Combat <tooltip-popup :text="combatAssumptions"><span class="info-icon">i</span></tooltip-popup></h2>
            <div class="combat-line">
              <tooltip-popup text="Combined Blizzard + Ice Blast DPS (approximate, single-target boss)"><span class="combat-total">Total {{ totalDps != null ? '~' + Math.round(totalDps).toLocaleString() : '---' }} DPS</span></tooltip-popup>
              <span> &nbsp;·&nbsp; </span><tooltip-popup :text="blizzTooltip"><span>Blizzard {{ blizzDps != null ? '~' + Math.round(blizzDps).toLocaleString() : '---' }}</span></tooltip-popup>
              <span> &nbsp;·&nbsp; </span><tooltip-popup :text="iceBlastTooltip"><span>Ice Blast {{ iceBlastDps != null ? '~' + Math.round(iceBlastDps).toLocaleString() : '---' }}</span></tooltip-popup>
            </div>
          </section>

          <!-- Drop Odds -->
          <section class="summary-block">
            <h2 class="panel-title">Drop Odds</h2>
            <div class="content-center">
              <div class="stat-line">
                <tooltip-popup text="Effective MF applied to unique quality checks after diminishing returns: MF×250÷(MF+250)"><span>Eff. Unique MF <span class="stat-val">{{ Math.round(effUniqueMF(totalMF)) }}%</span></span></tooltip-popup>
                <tooltip-popup text="Effective MF applied to set quality checks after diminishing returns: MF×500÷(MF+500)"><span>Eff. Set MF <span class="stat-val">{{ Math.round(effSetMF(totalMF)) }}%</span></span></tooltip-popup>
              </div>

              <div class="breakdown-group">
                <div class="breakdown-run-label">Per run cycle</div>
                <div class="breakdown-row breakdown-total breakdown-highlight">
                  <span>Any valuable <tooltip-popup text="P(at least one valuable drops across all selected bosses in one full run cycle)"><span class="info-icon">i</span></tooltip-popup></span>
                  <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.total) : '---' }}</span>
                </div>
                <div class="breakdown-row breakdown-sub">
                  <span>Good Unique / Set Item <tooltip-popup text="Any item from the Maxroll Med/High trade-value list (maxroll.gg/d2/items/valuable-unique-set-items) — Shako, Oculus, Mara's Kaleidoscope, etc. Accounts for MF diminishing returns and the quality roll."><span class="info-icon">i</span></tooltip-popup></span>
                  <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.itemProb) : '---' }}</span>
                </div>
                <div class="breakdown-row breakdown-sub">
                  <span>Good Rune <tooltip-popup text="Any rune Pul (r21) or better — tradeable for meaningful gear upgrades."><span class="info-icon">i</span></tooltip-popup></span>
                  <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.runeProb) : '---' }}</span>
                </div>
                <div class="breakdown-row breakdown-sub">
                  <span>Any Skiller GC <tooltip-popup text="A magic Grand Charm with any class skill tab prefix (e.g. +1 Cold Skills, +1 Combat Skills, etc.) — all 8 classes, 3 tabs each. Accounts for magic quality roll, P(has a prefix), and the skiller affix fraction."><span class="info-icon">i</span></tooltip-popup></span>
                  <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.skillerProb) : '---' }}</span>
                </div>
                <div class="breakdown-row breakdown-sub">
                  <span>Valuable SC <tooltip-popup text="A magic Small Charm with exactly +5 all res (Shimmering), +7% MF (of Good Luck), or +20 life (of Vita). Only the max roll counts. Accounts for P(has prefix/suffix) per the magic item layout distribution."><span class="info-icon">i</span></tooltip-popup></span>
                  <span>{{ totalDropProbs ? fmtOneIn(totalDropProbs.valuableScProb) : '---' }}</span>
                </div>
              </div>
            </div>

            <div class="fold-section">
              <button class="fold-header" @click="state.ui.folds.dropOddsBoss = !state.ui.folds.dropOddsBoss">
                <span class="fold-arrow">{{ state.ui.folds.dropOddsBoss ? '▶' : '▼' }}</span>
                Drop odds by run
              </button>
              <div v-if="!state.ui.folds.dropOddsBoss" class="breakdown-content">
                <template v-if="totalDropProbs">
                  <template v-for="run in runConfig" :key="run.id">
                    <template v-if="run.available && state.run.bosses[run.id] && runDropProbs[run.id]">
                      <div class="breakdown-run-label">{{ run.label }}</div>
                      <div class="breakdown-row breakdown-total breakdown-highlight">
                        <span>Any valuable <tooltip-popup text="P(at least one of: trade-value unique/set, good rune, skiller GC, or valuable SC drops this run)"><span class="info-icon">i</span></tooltip-popup></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].total) }}</span>
                      </div>
                      <div class="breakdown-row breakdown-sub">
                        <span>Good Unique / Set Item <tooltip-popup :text="runDropDetail(run.id, 'itemProb')"><span class="info-icon">i</span></tooltip-popup></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].itemProb) }}</span>
                      </div>
                      <div class="breakdown-row breakdown-sub">
                        <span>Good Rune <tooltip-popup :text="runDropDetail(run.id, 'runeProb')"><span class="info-icon">i</span></tooltip-popup></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].runeProb) }}</span>
                      </div>
                      <div class="breakdown-row breakdown-sub">
                        <span>Any Skiller GC <tooltip-popup :text="runDropDetail(run.id, 'skillerProb')"><span class="info-icon">i</span></tooltip-popup></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].skillerProb) }}</span>
                      </div>
                      <div class="breakdown-row breakdown-sub">
                        <span>Valuable SC <tooltip-popup :text="runDropDetail(run.id, 'valuableScProb')"><span class="info-icon">i</span></tooltip-popup></span>
                        <span>{{ fmtOneIn(runDropProbs[run.id].valuableScProb) }}</span>
                      </div>
                    </template>
                  </template>
                </template>
                <div v-else class="placeholder">Select a run above</div>
              </div>
            </div>
          </section>

        </div>

        <aside class="side-panel">

          <!-- ETTVD -->
          <time-to-valuable-drop-summary :ettvd="ettvd" />

          <!-- Run Routine -->
          <section class="summary-block">
            <h2 class="panel-title">Run Routine</h2>

            <div v-if="runConfig.length === 0" class="placeholder">Loading…</div>

            <template v-for="group in runsByAct" :key="group.act">
              <div class="run-act-header">ACT {{ group.act === 1 ? 'I' : group.act === 2 ? 'II' : group.act === 3 ? 'III' : group.act === 4 ? 'IV' : 'V' }}</div>
              <div v-for="run in group.runs" :key="run.id" class="run-row">
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
                <tooltip-popup v-if="run.available && runStats[run.id]" :text="runStats[run.id].assumptions">
                  <span class="info-icon">i</span>
                </tooltip-popup>
              </div>
            </template>

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
            <div class="breakdown-row breakdown-sub">
              <span>Overhead <tooltip-popup :text="runTimeSummary ? 'Game creation: ' + (runConfigMeta.game_creation_secs ?? 0) + 's · Town walks: ' + (runTimeSummary.overhead - (runConfigMeta.game_creation_secs ?? 0)).toFixed(1) + 's' : 'No run data'"><span class="info-icon">i</span></tooltip-popup></span>
              <span>{{ runTimeSummary ? runTimeSummary.overhead.toFixed(1) + 's' : '---' }}</span>
            </div>

            <div class="fold-section">
              <button class="fold-header" @click="state.ui.folds.breakdown = !state.ui.folds.breakdown">
                <span class="fold-arrow">{{ state.ui.folds.breakdown ? '▶' : '▼' }}</span>
                Time breakdown by run
              </button>
              <div v-if="!state.ui.folds.breakdown" class="breakdown-content">
                <template v-if="Object.values(runStats).some(s => s.hasKillData)">
                  <template v-for="run in runConfig" :key="run.id">
                    <template v-if="state.run.bosses[run.id] && runStats[run.id]?.hasKillData">
                      <div class="breakdown-run-label">{{ run.label }}</div>
                      <div class="breakdown-row">
                        <span>Travel <tooltip-popup :text="runStats[run.id].travelDetail"><span class="info-icon">i</span></tooltip-popup></span>
                        <span>{{ runStats[run.id].travelSecs.toFixed(1) }}s</span>
                      </div>
                      <div class="breakdown-row">
                        <span>Kill <tooltip-popup :text="runStats[run.id].killDetail"><span class="info-icon">i</span></tooltip-popup></span>
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

        <hr class="section-divider" />

        <div class="left-col">

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
              <template v-for="id in GROUP_A" :key="id">
                <div class="target-slot-row">
                  <div class="target-slot-left">
                    <div class="target-slot-top">
                      <span class="slot-label">{{ GEAR_SLOTS.find(s => s.id === id).label }}</span>
                      <span :class="['target-slot-name', !targetSlots[id].item && 'target-slot-empty']">
                        {{ targetSlots[id].item?.name ?? '—' }}
                      </span>
                    </div>
                    <div v-for="si in targetSlots[id].sockets" :key="si.id" class="target-socket-row">
                      <span class="socket-label">(socket)</span>
                      <span class="target-slot-name target-socket-name">{{ si.name }}</span>
                    </div>
                    <stat-pills :stats="targetSlots[id].stats" />
                  </div>
                </div>
              </template>
            </div>
            <div class="target-slot-group">
              <template v-for="id in GROUP_B" :key="id">
                <div class="target-slot-row">
                  <div class="target-slot-left">
                    <div class="target-slot-top">
                      <span class="slot-label">{{ GEAR_SLOTS.find(s => s.id === id).label }}</span>
                      <span :class="['target-slot-name', !targetSlots[id].item && 'target-slot-empty']">
                        {{ targetSlots[id].item?.name ?? '—' }}
                      </span>
                    </div>
                    <div v-for="si in targetSlots[id].sockets" :key="si.id" class="target-socket-row">
                      <span class="socket-label">(socket)</span>
                      <span class="target-slot-name target-socket-name">{{ si.name }}</span>
                    </div>
                    <stat-pills :stats="targetSlots[id].stats" />
                  </div>
                </div>
              </template>
            </div>

            <set-bonus-block :active-sets="targetActiveSetBonuses" />

            <div v-if="targetPresetCharms.length" class="target-charms-block">
              <div class="target-charms-header">Charms</div>
              <div v-for="c in targetPresetCharms" :key="c.id" class="target-slot-row">
                <span class="slot-label">{{ c.count > 1 ? c.count + '×' : '' }}</span>
                <span class="target-slot-name">{{ c.name }}</span>
                <stat-pills :stats="c.stats" :sunder="c.item?.sunder" />
              </div>
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title">Target Stats</h2>
            <div class="stat-line">
              <tooltip-popup :text="targetFcrTooltip"><span>FCR <span class="stat-val">{{ targetTotalFCR }}%</span> <span class="fcr-badge" :class="targetFcrBadgeClass">{{ targetFcrBreakpoint.frames }}f</span></span></tooltip-popup>
              <tooltip-popup v-if="targetTotalMF" text="Magic Find — increases chance of finding magic, rare, set, and unique items"><span>MF <span class="stat-val">+{{ targetTotalMF }}%</span></span></tooltip-popup>
              <tooltip-popup v-if="targetTotalAllSkills" text="+All Skills — adds to all character skill levels"><span>All Skills <span class="stat-val">+{{ targetTotalAllSkills }}</span></span></tooltip-popup>
              <tooltip-popup v-if="targetTotalColdSkills" text="+Cold Skills — adds to cold skill levels only"><span>Cold Skills <span class="stat-val">+{{ targetTotalColdSkills }}</span></span></tooltip-popup>
              <tooltip-popup v-if="targetTotalColdDmgPct" text="+% Cold Skill Damage — multiplies cold spell damage output"><span>Cold Damage <span class="stat-val">+{{ targetTotalColdDmgPct }}%</span></span></tooltip-popup>
              <tooltip-popup v-if="targetTotalEnemyColdResPct" text="Enemy Cold Resist -X% from target gear — reduces enemy cold resistance, stacks with Cold Mastery"><span>Enemy CR <span class="stat-val">-{{ targetTotalEnemyColdResPct }}%</span></span></tooltip-popup>
              <tooltip-popup v-for="s in targetSunders" :key="s" :text="'Sunders ' + s + ' immunity'"><span class="pill pill-sunder">Sunders {{ s }}</span></tooltip-popup>
              <tooltip-popup text="Cold Mastery effective level includes +All Skills and +Cold Skills from target gear"><span>Cold Mastery <span class="stat-val">Lv {{ targetEffectiveColdMastery }}</span></span></tooltip-popup>
            </div>
            <div class="cm-input-row">
              <label class="cm-label">
                Cold Mastery base pts
                <span class="custom-num cm-readonly">{{ state.coldMasteryBase }}</span>
                <span class="cm-breakdown">(from above · +{{ targetTotalAllSkills + targetTotalColdSkills }} from target gear)</span>
              </label>
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title">Target Combat <tooltip-popup :text="targetCombatAssumptions"><span class="info-icon">i</span></tooltip-popup></h2>
            <div class="combat-line">
              <tooltip-popup text="Combined Blizzard + Ice Blast DPS (approximate, single-target boss)"><span class="combat-total">Total {{ targetTotalDps != null ? '~' + Math.round(targetTotalDps).toLocaleString() : '---' }} DPS</span></tooltip-popup>
              <span> &nbsp;·&nbsp; </span><tooltip-popup :text="targetBlizzTooltip"><span>Blizzard {{ targetBlizzDps != null ? '~' + Math.round(targetBlizzDps).toLocaleString() : '---' }}</span></tooltip-popup>
              <span> &nbsp;·&nbsp; </span><tooltip-popup :text="targetIceBlastTooltip"><span>Ice Blast {{ targetIceBlastDps != null ? '~' + Math.round(targetIceBlastDps).toLocaleString() : '---' }}</span></tooltip-popup>
            </div>

            <hr class="panel-divider" />

            <h2 class="panel-title">Target Run Info</h2>
            <div class="content-center">
              <div class="breakdown-row breakdown-highlight">
                <span>Any valuable <tooltip-popup :text="targetTotalDropProbs ? 'Good Unique/Set: ' + fmtOneIn(targetTotalDropProbs.itemProb) + ' · Good Rune: ' + fmtOneIn(targetTotalDropProbs.runeProb) + ' · Skiller GC: ' + fmtOneIn(targetTotalDropProbs.skillerProb) + ' · Valuable SC: ' + fmtOneIn(targetTotalDropProbs.valuableScProb) : 'No drop data'"><span class="info-icon">i</span></tooltip-popup></span>
                <span>{{ targetTotalDropProbs ? fmtOneIn(targetTotalDropProbs.total) : '---' }}</span>
              </div>
              <div class="breakdown-row">
                <span>Run time <tooltip-popup :text="targetRunTimeSummary ? 'Travel: ' + targetRunTimeSummary.travel.toFixed(1) + 's · Kill: ' + targetRunTimeSummary.kill.toFixed(1) + 's · Overhead: ' + targetRunTimeSummary.overhead.toFixed(1) + 's' : 'No run data'"><span class="info-icon">i</span></tooltip-popup></span>
                <span>{{ targetRunTimeSummary ? targetRunTimeSummary.total.toFixed(1) + 's' : '---' }}</span>
              </div>
            </div>

          </section>

        </div>

        <div class="side-panel">

          <!-- Target ETTVD -->
          <time-to-valuable-drop-summary :ettvd="targetEttvd" :is-target="true" />

        </div>

      </main>

      <teleport to="body">
        <div v-if="showResetConfirm" class="modal-backdrop" @click.self="showResetConfirm = false">
          <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title">
            <h2 id="reset-title" class="modal-title">Reset gear &amp; settings?</h2>
            <p class="modal-body">All gear selections and settings will be cleared.</p>
            <div class="modal-actions">
              <button class="modal-btn modal-btn-cancel" @click="showResetConfirm = false">Cancel</button>
              <button class="modal-btn modal-btn-confirm" @click="resetState">Reset</button>
            </div>
          </div>
        </div>
      </teleport>
    </div>
  `,
})
  .component('TooltipPopup', TooltipPopup);

(async () => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('s')) {
    const encoded = params.get('s');
    const ok = await decodeState(encoded, state);
    if (!ok) {
      Object.assign(state, makeDefaultState());
      stateError.value = 'Saved state could not be loaded (it may be from an older version). Starting fresh.';
    } else if (!encoded.startsWith('.')) {
      // Auto-upgrade legacy (non-gzip) URL to gzip format
      const reencoded = await encodeState(state);
      history.replaceState(null, '', reencoded ? `?s=${reencoded}` : location.pathname);
    }
  }
  app.mount('#app');
})();

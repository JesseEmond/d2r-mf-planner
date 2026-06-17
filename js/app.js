import { createApp, reactive, computed, watch } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';
import { GEAR_SLOTS, PRESET_ITEMS } from './gear-db.js';

const FCR_BREAKPOINTS = [
  { minFCR: 200, frames: 7 },
  { minFCR: 105, frames: 8 },
  { minFCR: 63,  frames: 9 },
  { minFCR: 37,  frames: 10 },
  { minFCR: 20,  frames: 11 },
  { minFCR: 9,   frames: 12 },
  { minFCR: 0,   frames: 13 },
];

function makeSlot() {
  return { preset: null, custom: { name: '', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 } };
}

function makeGear() {
  const gear = {};
  for (const { id } of GEAR_SLOTS) gear[id] = makeSlot();
  return gear;
}

function encodeState(state) {
  const gear = {};
  for (const { id } of GEAR_SLOTS) {
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
  const out = { gear };
  if (state.coldMasteryBase !== 20) out.cm = state.coldMasteryBase;
  if (state.run.overheadSecs !== 30) out.oh = state.run.overheadSecs;
  const bosses = {};
  for (const [k, v] of Object.entries(state.run.bosses)) {
    if (v) bosses[k] = 1;
  }
  if (Object.keys(bosses).length) out.bosses = bosses;
  return btoa(JSON.stringify(out));
}

function decodeState(b64, state) {
  try {
    const out = JSON.parse(atob(b64));
    if (out.gear) {
      for (const { id } of GEAR_SLOTS) {
        if (out.gear[id]) {
          const e = out.gear[id];
          state.gear[id].preset = e.p ?? null;
          if (e.p === 'custom') {
            state.gear[id].custom = {
              name: e.n ?? '',
              fcr: e.f ?? 0,
              mf: e.m ?? 0,
              allSkills: e.a ?? 0,
              coldSkills: e.cs ?? 0,
            };
          }
        }
      }
    }
    if (out.cm != null) state.coldMasteryBase = out.cm;
    if (out.oh != null) state.run.overheadSecs = out.oh;
    if (out.bosses) {
      for (const [k, v] of Object.entries(out.bosses)) {
        state.run.bosses[k] = !!v;
      }
    }
  } catch {}
}

function slotStats(slot) {
  if (!slot.preset) return { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
  if (slot.preset === 'custom') return slot.custom;
  // find preset by slotId — we need all presets; scan PRESET_ITEMS
  for (const presets of Object.values(PRESET_ITEMS)) {
    const item = presets.find(p => p.id === slot.preset);
    if (item) return item;
  }
  return { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
}

const state = reactive({
  gear: makeGear(),
  coldMasteryBase: 20,
  run: { bosses: {}, overheadSecs: 30 },
});

const params = new URLSearchParams(window.location.search);
if (params.has('s')) decodeState(params.get('s'), state);

const totalFCR = computed(() =>
  GEAR_SLOTS.reduce((sum, { id }) => sum + (slotStats(state.gear[id]).fcr || 0), 0)
);
const totalMF = computed(() =>
  GEAR_SLOTS.reduce((sum, { id }) => sum + (slotStats(state.gear[id]).mf || 0), 0)
);
const totalAllSkills = computed(() =>
  GEAR_SLOTS.reduce((sum, { id }) => sum + (slotStats(state.gear[id]).allSkills || 0), 0)
);
const totalColdSkills = computed(() =>
  GEAR_SLOTS.reduce((sum, { id }) => sum + (slotStats(state.gear[id]).coldSkills || 0), 0)
);
const effectiveColdMastery = computed(() =>
  state.coldMasteryBase + totalAllSkills.value + totalColdSkills.value
);
const fcrBreakpoint = computed(() => {
  const fcr = totalFCR.value;
  return FCR_BREAKPOINTS.find(bp => fcr >= bp.minFCR) ?? FCR_BREAKPOINTS[FCR_BREAKPOINTS.length - 1];
});

watch(state, () => {
  const encoded = encodeState(state);
  history.replaceState(null, '', `?s=${encoded}`);
}, { deep: true });

createApp({
  setup() {
    return {
      state,
      GEAR_SLOTS,
      PRESET_ITEMS,
      totalFCR,
      totalMF,
      totalAllSkills,
      totalColdSkills,
      effectiveColdMastery,
      fcrBreakpoint,
      slotStats,
    };
  },
  template: `<div>App mounted — commit 4 scaffold</div>`,
}).mount('#app');

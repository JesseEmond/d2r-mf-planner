import { createApp, defineComponent, reactive, computed, watch, ref, onMounted } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';
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

const GearSlot = defineComponent({
  props: {
    slotId:     { type: String, required: true },
    slotLabel:  { type: String, required: true },
    presets:    { type: Array,  required: true },
    modelValue: { type: Object, required: true },
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    function update(patch) {
      emit('update:modelValue', { ...props.modelValue, ...patch });
    }
    function updateCustom(patch) {
      emit('update:modelValue', {
        ...props.modelValue,
        custom: { ...props.modelValue.custom, ...patch },
      });
    }
    function stats() {
      const slot = props.modelValue;
      if (!slot.preset || slot.preset === 'custom') return slot.custom;
      return props.presets.find(p => p.id === slot.preset) ?? { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
    }
    return { update, updateCustom, stats };
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

      <div v-if="modelValue.preset === 'custom'" class="custom-inputs">
        <input type="text"   placeholder="Name"       :value="modelValue.custom.name"       @input="updateCustom({ name: $event.target.value })"              class="custom-text" />
        <label>FCR <input   type="number" min="0" :value="modelValue.custom.fcr"        @input="updateCustom({ fcr: +$event.target.value })"       class="custom-num" /></label>
        <label>MF  <input   type="number" min="0" :value="modelValue.custom.mf"         @input="updateCustom({ mf: +$event.target.value })"        class="custom-num" /></label>
        <label>+All <input  type="number" min="0" :value="modelValue.custom.allSkills"  @input="updateCustom({ allSkills: +$event.target.value })"  class="custom-num" /></label>
        <label>+Cold <input type="number" min="0" :value="modelValue.custom.coldSkills" @input="updateCustom({ coldSkills: +$event.target.value })" class="custom-num" /></label>
      </div>

      <div v-if="modelValue.preset" class="stat-pills">
        <span v-if="stats().fcr"       class="pill pill-fcr">FCR +{{ stats().fcr }}%</span>
        <span v-if="stats().mf"        class="pill pill-mf">MF +{{ stats().mf }}%</span>
        <span v-if="stats().allSkills"  class="pill pill-skill">+{{ stats().allSkills }} All</span>
        <span v-if="stats().coldSkills" class="pill pill-cold">+{{ stats().coldSkills }} Cold</span>
      </div>
    </div>
  `,
});

const GROUP_A = ['head', 'amulet', 'weapon', 'shield', 'armor'];
const GROUP_B = ['gloves', 'belt', 'boots', 'ring1', 'ring2', 'charms'];

const fcrBadgeClass = computed(() => {
  const fcr = totalFCR.value;
  const currentIdx = FCR_BREAKPOINTS.findIndex(bp => fcr >= bp.minFCR);
  if (currentIdx > 0) {
    const nextFaster = FCR_BREAKPOINTS[currentIdx - 1];
    if (fcr >= nextFaster.minFCR - 5) return 'badge-amber';
  }
  if (FCR_BREAKPOINTS.some(bp => bp.minFCR === fcr)) return 'badge-green';
  return 'badge-default';
});

createApp({
  components: { GearSlot },
  setup() {
    const runConfig = ref([]);

    onMounted(async () => {
      try {
        const res = await fetch('data/run_config.json');
        const json = await res.json();
        runConfig.value = json.runs;
        for (const run of json.runs) {
          if (run.available && state.run.bosses[run.id] === undefined) {
            state.run.bosses[run.id] = true;
          }
        }
      } catch (e) {
        console.error('Failed to load run_config.json', e);
      }
    });

    return {
      state,
      GEAR_SLOTS,
      PRESET_ITEMS,
      GROUP_A,
      GROUP_B,
      runConfig,
      totalFCR,
      totalMF,
      totalAllSkills,
      totalColdSkills,
      effectiveColdMastery,
      fcrBreakpoint,
      fcrBadgeClass,
    };
  },
  template: `
    <div class="app-root">
      <header class="app-header sticky-header">
        <h1>D2R Blizzard Sorc — ETTVD Optimizer</h1>
      </header>

      <main class="app-grid">
        <section class="gear-panel">
          <h2 class="panel-title">Gear</h2>
          <div class="slot-group">
            <gear-slot
              v-for="id in GROUP_A" :key="id"
              :slot-id="id"
              :slot-label="GEAR_SLOTS.find(s => s.id === id).label"
              :presets="PRESET_ITEMS[id]"
              v-model="state.gear[id]"
            />
          </div>
          <div class="slot-group">
            <gear-slot
              v-for="id in GROUP_B" :key="id"
              :slot-id="id"
              :slot-label="GEAR_SLOTS.find(s => s.id === id).label"
              :presets="PRESET_ITEMS[id]"
              v-model="state.gear[id]"
            />
          </div>
        </section>

        <aside class="side-panel">
          <!-- Stat Summary -->
          <section class="summary-block">
            <h2 class="panel-title">Stats</h2>

            <div class="stat-row">
              <span class="stat-label">FCR</span>
              <span class="stat-value">{{ totalFCR }}%</span>
              <span class="fcr-badge" :class="fcrBadgeClass">{{ fcrBreakpoint.frames }}f</span>
            </div>

            <div class="stat-row">
              <span class="stat-label">Magic Find</span>
              <span class="stat-value">{{ totalMF }}%</span>
            </div>

            <div class="stat-row">
              <span class="stat-label">+All Skills</span>
              <span class="stat-value">{{ totalAllSkills }}</span>
            </div>

            <div class="stat-row">
              <span class="stat-label">+Cold Skills</span>
              <span class="stat-value">{{ totalColdSkills }}</span>
            </div>

            <div class="stat-row cold-mastery-row">
              <span class="stat-label">Cold Mastery</span>
              <span class="stat-value">
                Lv {{ effectiveColdMastery }}
                <span class="cm-breakdown">({{ state.coldMasteryBase }} base)</span>
              </span>
            </div>
            <div class="cm-input-row">
              <label class="cm-label">
                Base pts (0–20)
                <input
                  type="number" min="0" max="20"
                  v-model.number="state.coldMasteryBase"
                  class="custom-num"
                />
              </label>
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
            </div>

            <div class="overhead-row">
              <label class="stat-label">
                Travel/overhead
                <input
                  type="number" min="0"
                  v-model.number="state.run.overheadSecs"
                  class="custom-num"
                />
                <span class="unit">s</span>
              </label>
            </div>
          </section>
        </aside>
      </main>

      <footer class="app-footer">
        <span class="footer-label">ETTVD:</span>
        <span class="footer-value">— <span class="coming-soon">coming soon</span></span>
      </footer>
    </div>
  `,
}).mount('#app');

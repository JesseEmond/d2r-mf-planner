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

// ── Combat engine constants ────────────────────────────────────────────────
const BLIZZARD_COOLDOWN_SECS  = 1.8;
const ICE_BLAST_HIT_RATE      = 0.80;   // fraction of ice blasts that connect
const D2_FPS                  = 25;
const BLIZZARD_BOLTS_VS_BOSS  = 4;      // approx bolts hitting a stationary boss
const BLIZZARD_HARD_PTS       = 20;     // assumed max hard points
const ICE_BLAST_HARD_PTS      = 20;     // assumed max hard points

// ── State helpers ──────────────────────────────────────────────────────────
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
  const bosses = {};
  for (const [k, v] of Object.entries(state.run.bosses)) {
    if (v) bosses[k] = 1;
  }
  if (Object.keys(bosses).length) out.bosses = bosses;
  const uf = Object.entries(state.ui.folds).filter(([, v]) => !v).map(([k]) => k);
  if (uf.length) out.uf = uf;
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
    if (out.bosses) {
      for (const [k, v] of Object.entries(out.bosses)) {
        state.run.bosses[k] = !!v;
      }
    }
    if (out.uf) {
      for (const key of out.uf) {
        if (key in state.ui.folds) state.ui.folds[key] = false;
      }
    }
  } catch {}
}

function slotStats(slot) {
  if (!slot.preset) return { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
  if (slot.preset === 'custom') return slot.custom;
  for (const presets of Object.values(PRESET_ITEMS)) {
    const item = presets.find(p => p.id === slot.preset);
    if (item) return item;
  }
  return { fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };
}

// ── Reactive state ─────────────────────────────────────────────────────────
const state = reactive({
  gear: makeGear(),
  coldMasteryBase: 20,
  run: { bosses: {} },
  ui: { folds: { breakdown: true } },
});

const params = new URLSearchParams(window.location.search);
if (params.has('s')) decodeState(params.get('s'), state);

// ── Gear computeds ─────────────────────────────────────────────────────────
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
const fcrTooltip = computed(() => {
  const fcr = totalFCR.value;
  const currentIdx = FCR_BREAKPOINTS.findIndex(bp => fcr >= bp.minFCR);
  const current = FCR_BREAKPOINTS[currentIdx];
  let tip = `${current.frames} frames per cast`;
  if (currentIdx > 0) {
    const next = FCR_BREAKPOINTS[currentIdx - 1];
    tip += ` · next breakpoint: ${next.minFCR}% FCR for ${next.frames}f (+${next.minFCR - fcr} needed)`;
  } else {
    tip += ' · maximum breakpoint reached';
  }
  return tip;
});

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

// ── Combat engine helpers ──────────────────────────────────────────────────
function blizzDmgFormula(slvl) {
  return BLIZZARD_BOLTS_VS_BOSS * (20 * slvl + 10);
}
function iceBlastDmgFormula(slvl) {
  return 10 * slvl + 10;
}
function iceBlastsPerWindow(framesPerCast) {
  const totalCasts = Math.floor(BLIZZARD_COOLDOWN_SECS / (framesPerCast / D2_FPS));
  return (totalCasts - 1) * ICE_BLAST_HIT_RATE;
}
function cmResistReduction(cmLevel) {
  return 15 + 5 * cmLevel;
}
function coldDmgMultiplier(monsterColdResist, cmLevel) {
  const effectiveResist = Math.max(-100, monsterColdResist - cmResistReduction(cmLevel));
  return (100 - effectiveResist) / 100;
}

// ── Combat computeds ───────────────────────────────────────────────────────
const blizzSlvl = computed(() => BLIZZARD_HARD_PTS + totalAllSkills.value + totalColdSkills.value);
const iceBlastSlvl = computed(() => ICE_BLAST_HARD_PTS + totalAllSkills.value + totalColdSkills.value);
const effectiveIceBlastsPerWindow = computed(() => iceBlastsPerWindow(fcrBreakpoint.value.frames));
const blizzDmgPerCast = computed(() => blizzDmgFormula(blizzSlvl.value));
const iceBlastDmgPerHit = computed(() => iceBlastDmgFormula(iceBlastSlvl.value));
const blizzDps = computed(() => blizzDmgPerCast.value / BLIZZARD_COOLDOWN_SECS);
const iceBlastDps = computed(() =>
  effectiveIceBlastsPerWindow.value * iceBlastDmgPerHit.value / BLIZZARD_COOLDOWN_SECS
);
const totalDps = computed(() => blizzDps.value + iceBlastDps.value);
const combatAssumptions = computed(() => {
  const frames = fcrBreakpoint.value.frames;
  const ibs = effectiveIceBlastsPerWindow.value;
  return [
    `Blizzard: 1 cast / ${BLIZZARD_COOLDOWN_SECS}s cooldown, ~${BLIZZARD_BOLTS_VS_BOSS} bolts hitting boss per cast`,
    `Ice Blast: ${ibs.toFixed(1)} effective casts per window at ${ICE_BLAST_HIT_RATE * 100}% hit rate (${frames} frames/cast)`,
    `Skill levels assume ${BLIZZARD_HARD_PTS} hard points in each spell; scale with +All/+Cold Skills from gear`,
    `Boss HP = avg(minHP, maxHP) × L-HP[level] ÷ 100 (from monlvl.txt)`,
    `Damage values are approximate`,
  ].join('\n');
});

watch(state, () => {
  const encoded = encodeState(state);
  history.replaceState(null, '', `?s=${encoded}`);
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
        <span v-if="stats().fcr"       class="pill pill-fcr"   title="Faster Cast Rate — reduces casting animation length">FCR +{{ stats().fcr }}%</span>
        <span v-if="stats().mf"        class="pill pill-mf"    title="Magic Find — increases chance of finding magic, rare, set, and unique items">MF +{{ stats().mf }}%</span>
        <span v-if="stats().allSkills"  class="pill pill-skill" title="+All Skills — adds to all character skill levels">+{{ stats().allSkills }} All</span>
        <span v-if="stats().coldSkills" class="pill pill-cold"  title="+Cold Skills — adds to cold skill levels only">+{{ stats().coldSkills }} Cold</span>
      </div>
    </div>
  `,
});

const GROUP_A = ['head', 'amulet', 'weapon', 'shield', 'armor'];
const GROUP_B = ['gloves', 'belt', 'boots', 'ring1', 'ring2', 'charms'];

// ── App ────────────────────────────────────────────────────────────────────
createApp({
  components: { GearSlot },
  setup() {
    const runConfig = ref([]);
    const monsterDb = ref(null);

    onMounted(async () => {
      try {
        const [rcRes, dbRes] = await Promise.all([
          fetch('data/run_config.json'),
          fetch('data/db.json'),
        ]);
        const [rc, db] = await Promise.all([rcRes.json(), dbRes.json()]);
        runConfig.value = rc.runs;
        monsterDb.value = db;
        for (const run of rc.runs) {
          if (run.available && state.run.bosses[run.id] === undefined) {
            state.run.bosses[run.id] = true;
          }
        }
      } catch (e) {
        console.error('Failed to load data', e);
      }
    });

    const runStats = computed(() => {
      const frames   = fcrBreakpoint.value.frames;
      const cmLevel  = effectiveColdMastery.value;
      const blizzDmg = blizzDmgPerCast.value;
      const ibDmg    = iceBlastDmgPerHit.value;
      const ibs      = effectiveIceBlastsPerWindow.value;

      const stats = {};
      for (const run of runConfig.value) {
        if (!run.available) continue;
        const travelSecs = (run.teleports ?? 0) * frames / D2_FPS;
        let killSecs = 0;

        const combat = monsterDb.value?.monsters?.[run.id]?.combat ?? {};
        if (state.run.bosses[run.id] && combat.hp) {
          const mult    = coldDmgMultiplier(combat.cold_resist ?? 0, cmLevel);
          const effDps  = (blizzDmg / BLIZZARD_COOLDOWN_SECS + ibs * ibDmg / BLIZZARD_COOLDOWN_SECS) * mult;
          const amount  = (run.monsters ?? []).reduce((s, m) => s + (m.amount ?? 1), 0) || 1;
          killSecs = (combat.hp / effDps) * amount;
        }

        const assumptionLines = [
          `Travel: ~${run.teleports ?? 0} teleports × ${frames} frames/cast ÷ ${D2_FPS} FPS = ${travelSecs.toFixed(1)}s`,
        ];
        if (combat.hp) {
          const mult = coldDmgMultiplier(combat.cold_resist ?? 0, cmLevel);
          assumptionLines.push(
            `HP: ${combat.hp.toLocaleString()}`,
            `Cold resist: ${combat.cold_resist ?? 0}% → ${mult.toFixed(2)}× damage multiplier`,
          );
        }

        stats[run.id] = {
          travelSecs,
          killSecs,
          totalSecs: travelSecs + killSecs,
          hasKillData: killSecs > 0,
          assumptions: assumptionLines.join('\n'),
        };
      }
      return stats;
    });

    return {
      state,
      GEAR_SLOTS,
      PRESET_ITEMS,
      GROUP_A,
      GROUP_B,
      runConfig,
      runStats,
      totalFCR,
      totalMF,
      totalAllSkills,
      totalColdSkills,
      effectiveColdMastery,
      fcrBreakpoint,
      fcrBadgeClass,
      fcrTooltip,
      blizzDps,
      iceBlastDps,
      totalDps,
      combatAssumptions,
    };
  },
  template: `
    <div class="app-root">
      <header class="app-header sticky-header">
        <h1>D2R Blizzard Sorc — <abbr title="Expected Time To Valuable Drop — estimated average runs until a desirable item drops, given your MF and run routine">ETTVD</abbr> Optimizer</h1>
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
            <div class="summary-pills">
              <span class="pill pill-fcr" title="Faster Cast Rate — reduces casting animation length">
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
          </section>

          <!-- Combat -->
          <section class="summary-block">
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

            <div v-if="Object.values(runStats).some(s => s.hasKillData)" class="fold-section">
              <button class="fold-header" @click="state.ui.folds.breakdown = !state.ui.folds.breakdown">
                <span class="fold-arrow">{{ state.ui.folds.breakdown ? '▶' : '▼' }}</span>
                Per-boss breakdown
              </button>
              <div v-if="!state.ui.folds.breakdown" class="breakdown-content">
                <template v-for="run in runConfig" :key="run.id">
                  <template v-if="state.run.bosses[run.id] && runStats[run.id]?.hasKillData">
                    <div class="breakdown-run-label">{{ run.label }}</div>
                    <div class="breakdown-row">
                      <span>Travel</span><span>{{ runStats[run.id].travelSecs.toFixed(1) }}s</span>
                    </div>
                    <div class="breakdown-row">
                      <span>Kill</span><span>{{ runStats[run.id].killSecs.toFixed(1) }}s</span>
                    </div>
                    <div class="breakdown-row breakdown-total">
                      <span>Total</span><span>{{ runStats[run.id].totalSecs.toFixed(1) }}s</span>
                    </div>
                  </template>
                </template>
              </div>
            </div>
          </section>

        </aside>
      </main>

      <footer class="app-footer">
        <abbr class="footer-label" title="Expected Time To Valuable Drop — estimated average runs until a desirable item drops, given your MF and run routine">ETTVD:</abbr>
        <span class="footer-value">— <span class="coming-soon">coming soon</span></span>
      </footer>
    </div>
  `,
}).mount('#app');

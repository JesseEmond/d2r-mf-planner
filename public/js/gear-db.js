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

// { id, name, fcr, mf, allSkills, coldSkills, notes? }
const custom = { id: 'custom', name: 'Custom / Other', fcr: 0, mf: 0, allSkills: 0, coldSkills: 0 };

export const PRESET_ITEMS = {
  head: [
    { id: 'shako',    name: "Harlequin Crest",  fcr: 0,  mf: 70, allSkills: 2, coldSkills: 0 },
    { id: 'griffons', name: "Griffon's Eye",     fcr: 25, mf: 0,  allSkills: 1, coldSkills: 0 },
    { id: 'lore',     name: "Lore (runeword)",   fcr: 0,  mf: 0,  allSkills: 1, coldSkills: 0 },
    custom,
  ],
  amulet: [
    { id: 'maras',        name: "Mara's Kaleidoscope", fcr: 0, mf: 0,  allSkills: 2, coldSkills: 0 },
    { id: 'eye_of_etlich',name: "The Eye of Etlich",   fcr: 0, mf: 20, allSkills: 1, coldSkills: 0 },
    custom,
  ],
  weapon: [
    { id: 'oculus',    name: "The Oculus",        fcr: 20, mf: 50, allSkills: 3, coldSkills: 3 },
    { id: 'hoto',      name: "Heart of the Oak",  fcr: 40, mf: 0,  allSkills: 3, coldSkills: 0 },
    { id: 'wizardspike',name: "Wizardspike",       fcr: 50, mf: 0,  allSkills: 0, coldSkills: 0 },
    { id: 'eschuta',   name: "Eschuta's Temper",  fcr: 20, mf: 0,  allSkills: 0, coldSkills: 3 },
    custom,
  ],
  shield: [
    { id: 'spirit',  name: "Spirit (monarch)",  fcr: 35, mf: 0,  allSkills: 2, coldSkills: 0 },
    { id: 'lidless', name: "Lidless Wall",       fcr: 20, mf: 0,  allSkills: 1, coldSkills: 0 },
    custom,
  ],
  armor: [
    { id: 'vipermagi', name: "Skin of the Vipermagi", fcr: 30, mf: 30,  allSkills: 1, coldSkills: 0 },
    { id: 'enigma',    name: "Enigma (runeword)",      fcr: 0,  mf: 45,  allSkills: 2, coldSkills: 0 },
    { id: 'wealth',    name: "Wealth (runeword)",       fcr: 0,  mf: 100, allSkills: 0, coldSkills: 0 },
    custom,
  ],
  gloves: [
    { id: 'magefist',   name: "Magefist",              fcr: 20, mf: 0, allSkills: 0, coldSkills: 1 },
    { id: 'trang_claws',name: "Trang-Oul's Claws",     fcr: 20, mf: 0, allSkills: 0, coldSkills: 0 },
    custom,
  ],
  belt: [
    { id: 'arachnid', name: "Arachnid Mesh",               fcr: 20, mf: 0,  allSkills: 1, coldSkills: 0 },
    { id: 'goldwrap',  name: "Goldwrap",                    fcr: 0,  mf: 65, allSkills: 0, coldSkills: 0 },
    { id: 'tal_belt',  name: "Tal Rasha's Fine-Spun Cloth", fcr: 20, mf: 0,  allSkills: 0, coldSkills: 0 },
    custom,
  ],
  boots: [
    { id: 'war_traveler', name: "War Traveler", fcr: 0, mf: 45, allSkills: 0, coldSkills: 0 },
    { id: 'silkweave',    name: "Silkweave",    fcr: 0, mf: 30, allSkills: 0, coldSkills: 0 },
    { id: 'waterwalk',    name: "Waterwalk",    fcr: 0, mf: 15, allSkills: 0, coldSkills: 0 },
    custom,
  ],
  ring1: [
    { id: 'soj',     name: "Stone of Jordan", fcr: 0,  mf: 40, allSkills: 1, coldSkills: 0 },
    { id: 'nagel',   name: "Nagelring",        fcr: 0,  mf: 25, allSkills: 0, coldSkills: 0 },
    { id: 'rare_fcr',name: "Rare FCR Ring",    fcr: 10, mf: 0,  allSkills: 0, coldSkills: 0 },
    custom,
  ],
  ring2: [
    { id: 'soj',     name: "Stone of Jordan", fcr: 0,  mf: 40, allSkills: 1, coldSkills: 0 },
    { id: 'nagel',   name: "Nagelring",        fcr: 0,  mf: 25, allSkills: 0, coldSkills: 0 },
    { id: 'rare_fcr',name: "Rare FCR Ring",    fcr: 10, mf: 0,  allSkills: 0, coldSkills: 0 },
    custom,
  ],
  charms: [
    custom,
  ],
};

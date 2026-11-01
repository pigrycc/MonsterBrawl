/**
 * Monster roster — the 5 low-poly archetypes from GDD §7.
 *
 * Stats are normalized prototype values (not final balance). `maxHp`, `speed`
 * (m/s target) and `maxStamina` drive combat; `affinity` is the element the
 * training-cell totem draft is weighted toward (GDD §4A). `basicAttackSkillId`
 * references a skill id in src/shared/skills.js. Visual fields drive the
 * low-poly procedural model builder in the renderer.
 */

/** @typedef {import('./skills.js').Element} Element */

/**
 * @typedef {Object} Monster
 * @property {string} id
 * @property {string} name
 * @property {Element} affinity
 * @property {string} role
 * @property {number} maxHp
 * @property {number} speed          Base move speed (m/s)
 * @property {number} maxStamina
 * @property {number} basicAttackSkillId
 * @property {string} basicAttackName
 * @property {number} color          Primary body color (hex)
 * @property {number} accent         Accent/shell color (hex)
 * @property {string} silhouette     Procedural model archetype key
 * @property {string} description
 */

/** @type {Monster[]} */
export const MONSTERS = [
  {
    id: 'pyroroc',
    name: 'Pyroroc',
    affinity: 'Fire',
    role: 'Melee Brawler',
    maxHp: 140,
    speed: 3.2,
    maxStamina: 100,
    basicAttackSkillId: 11, // Ember-flavored, but melee Flaming Claw — see basicAttackName
    basicAttackName: 'Flaming Claw',
    color: 0xcc3a1b,
    accent: 0x2b2b2b, // obsidian shell
    silhouette: 'biped_stocky',
    description: 'Bipedal stocky lava-reptile with an obsidian shell. High HP, slow speed.',
  },
  {
    id: 'aquaslug',
    name: 'Aquaslug',
    affinity: 'Water',
    role: 'Ranged Skirmisher',
    maxHp: 95,
    speed: 4.0,
    maxStamina: 100,
    basicAttackSkillId: 13, // Water Spurt ~= Water_Gun
    basicAttackName: 'Water Spurt',
    color: 0x2f7fd1,
    accent: 0x8fd3ff,
    silhouette: 'slug_stalked',
    description: 'Blue jelly-like mollusk with dual eye-stalks. Lower HP, balanced speed.',
  },
  {
    id: 'voltkid',
    name: 'Voltkid',
    affinity: 'Electric',
    role: 'Fast Skirmisher',
    maxHp: 105,
    speed: 5.4,
    maxStamina: 100,
    basicAttackSkillId: 47, // Static Shock ~ electric flavor (Confuse_Ray element=Electric)
    basicAttackName: 'Static Shock',
    color: 0xf2d02c,
    accent: 0x3a3a3a,
    silhouette: 'fox_angular',
    description: 'Agile geometric spark-fox with oversized ears. Balanced HP, high speed.',
  },
  {
    id: 'terrataur',
    name: 'Terrataur',
    affinity: 'Earth',
    role: 'Pure Tank',
    maxHp: 180,
    speed: 2.6,
    maxStamina: 100,
    basicAttackSkillId: 5, // Heavy Headbutt ~= Headbutt
    basicAttackName: 'Heavy Headbutt',
    color: 0x7a6a52,
    accent: 0x4b4a46, // slate armor
    silhouette: 'quad_armored',
    description: 'Low-slung quadruped armadillo with slate armor. Very high HP, low speed.',
  },
  {
    id: 'galebird',
    name: 'Galebird',
    affinity: 'Flying',
    role: 'Ranged Harasser',
    maxHp: 80,
    speed: 6.2,
    maxStamina: 100,
    basicAttackSkillId: 17, // Razor Feather ~ ranged projectile (Bullet_Seed mechanics)
    basicAttackName: 'Razor Feather',
    color: 0x9fb4c9,
    accent: 0xdfe8f2,
    silhouette: 'raptor_hover',
    description: 'Stylized geometric raptor hovering above the sand. Low HP, very high mobility.',
  },
];

const BY_ID = new Map(MONSTERS.map((m) => [m.id, m]));

/** @param {string} id @returns {Monster|undefined} */
export const getMonster = (id) => BY_ID.get(id);

export const MONSTER_IDS = MONSTERS.map((m) => m.id);

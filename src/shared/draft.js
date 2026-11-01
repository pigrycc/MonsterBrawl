/**
 * Training-cell skill totem draft generation — GDD §4A.
 *
 * Rules implemented:
 *  - Spawn exactly 6 skill totems.
 *  - Weighted toward the monster's elemental affinity.
 *  - GUARANTEE: the 6 offered totems ALWAYS include at least four skills the
 *    player can currently afford, so no one is soft-locked out of a 4-skill
 *    build. "Affordable" accounts for the toggleAllSkillsFree debug flag.
 *
 * The generator is deterministic given an RNG, so the authoritative host can
 * drive it with a seeded RNG and replicate the same draft to clients.
 */

import { SKILLS, affordableSkills } from './skills.js';

/** @typedef {import('./skills.js').Skill} Skill */

const TOTEM_COUNT = 6;
const MIN_AFFORDABLE = 4;
const AFFINITY_WEIGHT = 3; // affinity-matching skills are this many times likelier

/** Mulberry32 — small seeded PRNG for deterministic, replicable drafts. */
export function makeRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Weighted sample without replacement. */
function weightedPick(pool, weightOf, rng) {
  const total = pool.reduce((s, item) => s + weightOf(item), 0);
  if (total <= 0) return pool[Math.floor(rng() * pool.length)];
  let r = rng() * total;
  for (const item of pool) {
    r -= weightOf(item);
    if (r <= 0) return item;
  }
  return pool[pool.length - 1];
}

/**
 * Generate the 6 totem skills for a training cell.
 * @param {Object} opts
 * @param {import('./monsters.js').Monster} opts.monster  bound monster (for affinity)
 * @param {number} opts.gold          player's current gold
 * @param {boolean} [opts.allFree]    toggleAllSkillsFree debug flag
 * @param {() => number} [opts.rng]   seeded RNG (0..1)
 * @returns {Skill[]} exactly 6 distinct skills, ≥4 affordable
 */
export function generateTotemDraft({ monster, gold, allFree = false, rng = makeRng() }) {
  const affinity = monster?.affinity;
  const effectiveGold = allFree ? Infinity : gold;

  const isAffordable = (s) => (allFree ? true : s.cost <= effectiveGold);
  const weightOf = (s) => (s.element === affinity ? AFFINITY_WEIGHT : 1);

  const affordablePool = SKILLS.filter(isAffordable);
  const unaffordablePool = SKILLS.filter((s) => !isAffordable(s));

  /** @type {Skill[]} */
  const chosen = [];
  const used = new Set();

  const take = (pool) => {
    const avail = pool.filter((s) => !used.has(s.id));
    if (avail.length === 0) return null;
    const pick = weightedPick(avail, weightOf, rng);
    used.add(pick.id);
    chosen.push(pick);
    return pick;
  };

  // Step 1: satisfy the anti-softlock guarantee first.
  const needAffordable = Math.min(MIN_AFFORDABLE, affordablePool.length);
  for (let i = 0; i < needAffordable; i++) take(affordablePool);

  // Step 2: fill remaining slots from the full pool (affordable first bias via
  // affinity weighting applies to everything). Prefer affordable, then allow
  // pricey "aspirational" skills to round out the 6.
  while (chosen.length < TOTEM_COUNT) {
    const picked = take(affordablePool) || take(unaffordablePool);
    if (!picked) break; // pools exhausted (only in tiny test DBs)
  }

  return chosen.slice(0, TOTEM_COUNT);
}

export const DRAFT_TOTEM_COUNT = TOTEM_COUNT;
export const DRAFT_MIN_AFFORDABLE = MIN_AFFORDABLE;

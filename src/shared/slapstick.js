/**
 * Slapstick miss reactions (GDD §10 "Slapstick_Mechanic_Description").
 *
 * Every skill in the sheet has a comedic penalty for whiffing. This module maps
 * each skill to a REACTION category (derived from its slapstick text) that the
 * arena renderer turns into a physical animation when a cast misses. Keeping the
 * mapping here (shared) means the host can authoritatively decide the reaction
 * and replicate it to clients (per-client sync, #2).
 */
import { SKILLS, getSkillById } from './skills.js';

/** Reaction categories → how the body physically reacts on a miss. */
export const REACTION = {
  TRIP: 'TRIP',           // stumble forward / fall flat
  PANCAKE: 'PANCAKE',     // flatten to the sand (belly flop)
  SPIN: 'SPIN',           // whirl 360° from an overswing
  PINBALL: 'PINBALL',     // bounce off walls
  RECOIL: 'RECOIL',       // knocked/launched backward
  DIZZY: 'DIZZY',         // wobble, stars overhead
  FACEPLANT: 'FACEPLANT', // slam face-first (wall/ground)
  NONE: 'NONE',           // no distinct physical whiff
};

/**
 * Classify a skill's slapstick text into a REACTION. Heuristic keyword match
 * over the sheet descriptions, with explicit overrides for the clearest cases.
 * @param {import('./skills.js').Skill} skill
 * @returns {string} REACTION
 */
export function reactionFor(skill) {
  const s = (skill?.slapstick || '').toLowerCase();
  if (!s) return REACTION.NONE;
  if (s.includes('trip') || s.includes('stumble')) return REACTION.TRIP;
  if (s.includes('pancake') || s.includes('flat on sand') || s.includes('belly')) return REACTION.PANCAKE;
  if (s.includes('spins') || s.includes('360') || s.includes('spin')) return REACTION.SPIN;
  if (s.includes('pinball') || s.includes('bounces violently')) return REACTION.PINBALL;
  if (s.includes('launch') || s.includes('backwards') || s.includes('knocks back') || s.includes('recoil') || s.includes('pushed back')) return REACTION.RECOIL;
  if (s.includes('dizzy') || s.includes('confused') || s.includes('paralyzed') || s.includes('tongue')) return REACTION.DIZZY;
  if (s.includes('stun') || s.includes('wall') || s.includes('face')) return REACTION.FACEPLANT;
  return REACTION.NONE;
}

/** Precomputed id → reaction map for all 50 skills. */
export const REACTION_BY_SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, reactionFor(s)]));

/** @param {number} skillId */
export function reactionForId(skillId) {
  return REACTION_BY_SKILL[skillId] ?? REACTION.NONE;
}

/**
 * Effective hit range (metres) for a skill, used to decide hit vs. miss.
 * Melee/short skills need the foe close; ranged/projectile skills reach far.
 * @param {import('./skills.js').Skill} skill
 */
export function skillRange(skill) {
  const t = (skill?.targetType || '').toLowerCase();
  if (t.includes('melee') || t.includes('cone_short') || t.includes('point_blank')) return 3.0;
  if (t.includes('self')) return Infinity; // self-buffs never "miss" on range
  if (t.includes('beam') || t.includes('ray') || t.includes('projectile') || t.includes('orb') || t.includes('arc')) return 14.0;
  if (t.includes('aoe') || t.includes('radial') || t.includes('floor') || t.includes('cloud') || t.includes('arena')) return 8.0;
  return 7.0;
}

/**
 * Decide whether a cast hits, given the distance to the foe. Self/utility skills
 * with no damage always "land" (no slapstick). Returns {hit, reaction}.
 * @param {number} skillId
 * @param {number} distanceToFoe
 */
export function resolveCast(skillId, distanceToFoe) {
  const skill = getSkillById(skillId);
  if (!skill) return { hit: false, reaction: REACTION.NONE };
  const range = skillRange(skill);
  if (range === Infinity) return { hit: true, reaction: REACTION.NONE }; // self
  const hit = distanceToFoe <= range;
  return { hit, reaction: hit ? REACTION.NONE : reactionForId(skillId) };
}

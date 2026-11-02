/**
 * Bot subsystem (GDD §8). Two profiles:
 *   - IDLE: passive target dummy — no drafting, no actions in the arena.
 *   - HUMANLIKE: drafts 4 affordable skills in prep; in the arena monitors
 *     stamina (rest under 30%, offensive when at an advantage), fires skills
 *     [1]-[4] when the opponent is in range, chases crowd drops, and shoves.
 *
 * The decision logic here is engine-agnostic and deterministic so it can run on
 * the authoritative host and be unit-tested. The arena/prep controllers call
 * these helpers; the bot never reaches into renderer internals.
 */
import { STANCES } from './combat.js';
import { getSkillById } from './skills.js';

export const BOT_PROFILES = { IDLE: 'IDLE', HUMANLIKE: 'HUMANLIKE' };

const REST_STAMINA_FRACTION = 0.30; // below this → rest ([F])
const OFFENSIVE_HP_ADVANTAGE = 0.0; // engage offensively when hp advantage >= this

/**
 * Pick 4 skills for a bot during preparation (GDD §8 Humanlike): cheapest-first
 * within the budget, preferring damage skills, from the cell's offered totems.
 * Mutates the TrainingCell (purchases). Returns the chosen totem indices.
 * @param {import('./prepSession.js').TrainingCell} cell
 */
export function botDraft(cell) {
  const chosenIdx = [];
  const guard = 20; // safety against pathological loops
  let n = 0;
  while (!cell.isReady && n++ < guard) {
    const slotsLeftAfter = cell.slots.filter((s) => s === null).length - 1;

    // Costs of the cheapest *other* purchasable totems — used to make sure we
    // keep a solvent path to a full 4-skill build (correctness before greed).
    const purchasable = cell.totems
      .map((t, i) => ({ i, cost: cell.costOf(t.skill), dmg: t.skill.damage, can: cell.canPurchase(i) }))
      .filter((x) => x.can);
    if (purchasable.length === 0) break;

    let best = -1, bestScore = -Infinity;
    for (const cand of purchasable) {
      // Budget we'd have left after buying this candidate.
      const remaining = cell.gold - cand.cost;
      // Cheapest `slotsLeftAfter` *other* totems must still fit the remaining budget.
      const others = purchasable.filter((x) => x.i !== cand.i).map((x) => x.cost).sort((a, b) => a - b);
      const reserveNeeded = others.slice(0, Math.max(0, slotsLeftAfter)).reduce((s, c) => s + c, 0);
      if (others.length < slotsLeftAfter) continue;       // can't complete 4 via this pick
      if (remaining < reserveNeeded) continue;             // would strand the budget
      const dmg = cand.dmg > 0 ? cand.dmg : 5;             // small value for utility
      const score = dmg * 10 - cand.cost * 3;
      if (score > bestScore) { bestScore = score; best = cand.i; }
    }
    // Fallback: if nothing kept a solvent path (shouldn't happen given the
    // draft's collective-affordability guarantee), take the cheapest.
    if (best < 0) best = purchasable.sort((a, b) => a.cost - b.cost)[0].i;

    cell.purchase(best);
    chosenIdx.push(best);
  }
  return chosenIdx;
}

/**
 * Decide the bot's desired stance this tick (GDD §8 Humanlike).
 * @param {import('./combat.js').MonsterCombatant} self
 * @param {import('./combat.js').MonsterCombatant} foe
 * @returns {string} a STANCES value
 */
export function botChooseStance(self, foe) {
  if (self.staminaFraction < REST_STAMINA_FRACTION) return STANCES.NEUTRAL; // rest to recover
  const hpAdvantage = (self.hp / self.maxHp) - (foe.hp / foe.maxHp);
  if (hpAdvantage >= OFFENSIVE_HP_ADVANTAGE) return STANCES.OFFENSIVE;
  // Behind on HP and not exhausted → guard up.
  return STANCES.DEFENSIVE;
}

/**
 * Choose a skill to cast this opportunity, or null. Prefers the highest-damage
 * ready skill the bot can afford (stamina) when the opponent is in range.
 * @param {import('./combat.js').MonsterCombatant} self
 * @param {number} distanceToFoe
 * @param {number} [skillRange]
 * @returns {number|null} skillId
 */
export function botChooseSkill(self, distanceToFoe, skillRange = 6) {
  if (self.isStunned) return null;
  if (distanceToFoe > skillRange) return null;
  let bestId = null, bestDmg = -1;
  for (const id of self.skillIds) {
    if (id == null || !self.canCast(id)) continue;
    const s = getSkillById(id);
    const dmg = s.damage > 0 ? s.damage : 0;
    if (dmg > bestDmg) { bestDmg = dmg; bestId = id; }
  }
  return bestId;
}

export const BOT_REST_FRACTION = REST_STAMINA_FRACTION;

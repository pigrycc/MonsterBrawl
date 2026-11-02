/**
 * Spectator throwables (GDD §6) + their effects. Engine-agnostic definitions so
 * the effect rules are testable and shared by client + host.
 *
 * Items spectators lob from the stands onto the arena:
 *   - ROTTEN_TOMATO: blinds a trainer's FPP view 5s (red goop); on a monster →
 *     5s confused wander.
 *   - STONE: 1.5s stun to a trainer or monster.
 *   - SPEED_DRAFT: dropped to assist an ally (speed/stamina boost).
 */
import { MonsterCombatant } from './combat.js';

export const THROWABLES = {
  ROTTEN_TOMATO: 'ROTTEN_TOMATO',
  STONE: 'STONE',
  SPEED_DRAFT: 'SPEED_DRAFT',
};

export const THROWABLE_INFO = {
  ROTTEN_TOMATO: { name: 'Rotten Tomato', color: 0xc0392b, blindTrainerSec: 5, confuseMonsterSec: 5 },
  STONE: { name: 'Stone', color: 0x7a7a7a, stunSec: 1.5 },
  SPEED_DRAFT: { name: 'Speed Draft', color: 0x3fd0a0, speedSec: 5, staminaBoost: 25 },
};

export const STONE_STUN = 1.5;
export const TOMATO_BLIND = 5;
export const TOMATO_CONFUSE = 5;

/**
 * Apply a throwable's effect to a target.
 * @param {string} kind  THROWABLES key
 * @param {Object} target  a MonsterCombatant (monster hit) or a trainer-effect sink
 * @param {Object} [opts]
 * @param {boolean} [opts.isMonster]  whether the target is a monster (vs a trainer)
 * @returns {{effect:string, durationSec:number}|null}
 */
export function applyThrowable(kind, target, { isMonster = true } = {}) {
  const info = THROWABLE_INFO[kind];
  if (!info || !target) return null;

  switch (kind) {
    case THROWABLES.STONE: {
      if (isMonster && target instanceof MonsterCombatant) {
        // A stone stun is modeled as a short forced stun window.
        target.stunTimer = Math.max(target.stunTimer, STONE_STUN);
        target.stunCount += 1;
      } else if (target.applyStun) {
        target.applyStun(STONE_STUN);
      }
      return { effect: 'stun', durationSec: STONE_STUN };
    }
    case THROWABLES.ROTTEN_TOMATO: {
      if (isMonster) {
        if (target.applyConfuse) target.applyConfuse(TOMATO_CONFUSE);
        return { effect: 'confuse', durationSec: TOMATO_CONFUSE };
      }
      if (target.applyBlind) target.applyBlind(TOMATO_BLIND);
      return { effect: 'blind', durationSec: TOMATO_BLIND };
    }
    case THROWABLES.SPEED_DRAFT: {
      if (isMonster && target instanceof MonsterCombatant) {
        target.stamina = Math.min(target.maxStamina, target.stamina + info.staminaBoost);
      } else if (target.applySpeed) {
        target.applySpeed(info.speedSec);
      }
      return { effect: 'speed', durationSec: info.speedSec };
    }
    default: return null;
  }
}

/** Random crate contents, weighted toward tomatoes/stones (offense). */
export function randomThrowable(rng = Math.random) {
  const r = rng();
  if (r < 0.45) return THROWABLES.ROTTEN_TOMATO;
  if (r < 0.85) return THROWABLES.STONE;
  return THROWABLES.SPEED_DRAFT;
}

/**
 * Trainer combat state (feedback #2). Trainers have their own HP, shown on the
 * FPP HUD (local) and as overhead world-space bars (all trainers).
 *
 * Damage rules:
 *   - Trainers CANNOT directly damage each other (LMB is a utility shove only).
 *   - Trainers CAN take damage from monsters — both active skills/AoE and
 *     targeted basic attacks (via takeDamage).
 *
 * Engine-agnostic so it lives in the authoritative runner and is unit-testable.
 */
export const TRAINER_MAX_HP = 100;

export class TrainerState {
  /** @param {string} playerId @param {number} [maxHp] */
  constructor(playerId, maxHp = TRAINER_MAX_HP) {
    this.playerId = playerId;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.alive = true;
  }

  get hpFraction() { return this.maxHp > 0 ? this.hp / this.maxHp : 0; }

  /**
   * Apply monster-sourced damage to the trainer. Returns damage dealt.
   * `source` must be 'monster' — trainer-vs-trainer damage is rejected so the
   * shove stays purely a knockback utility (#2).
   */
  takeDamage(amount, source = 'monster') {
    if (!this.alive || amount <= 0) return 0;
    if (source !== 'monster') return 0; // trainers can't damage each other
    const dmg = Math.round(amount);
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp === 0) this.alive = false;
    return dmg;
  }

  heal(n) { this.hp = Math.min(this.maxHp, this.hp + n); }
}

/**
 * Authoritative combat simulation core (GDD §5). Engine-agnostic and
 * deterministic so it can run on the host and be unit-tested headlessly. The
 * renderer reads MonsterCombatant/CombatMatch state to draw; it never owns the
 * rules.
 *
 * Models (GDD §5B/C/D):
 *   - Stances with a 2.0s behavioral delay (command now, takes effect in 2s).
 *   - Stamina 0..100: below 50% → 30% slower; at 0 → 3.0s ragdoll stun.
 *   - Stamina regen: Rest +1 per 2s, otherwise +1 per 4s (in combat).
 *   - Defensive stance: incoming skill damage −50%, and fully neutralizes the
 *     next ONE incoming basic attack.
 *   - Match clock (default 180s via debug). Sudden Death after it expires: the
 *     next point of damage to either monster ends the match.
 *   - Rewards: +30 winner / +20 loser (debug-configurable).
 */
import { DebugConfig } from './debugConfig.js';
import { getMonster } from './monsters.js';
import { getSkillById } from './skills.js';

export const STANCES = { OFFENSIVE: 'OFFENSIVE', DEFENSIVE: 'DEFENSIVE', NEUTRAL: 'NEUTRAL' };
export const STANCE_DELAY = 2.0;           // GDD §5B behavioral delay
export const LOW_STAMINA_FRACTION = 0.5;   // below this → slowed
export const LOW_STAMINA_SLOW = 0.7;       // 30% slower → 0.7x speed
export const STUN_DURATION = 3.0;          // 0-stamina ragdoll stun
export const REGEN_REST_PER_SEC = 0.5;     // +1 / 2s
export const REGEN_COMBAT_PER_SEC = 0.25;  // +1 / 4s
export const DEFENSIVE_SKILL_MULT = 0.5;   // −50% skill damage while defending

/**
 * One monster in the arena. Trainer commands set `pendingStance`; it becomes
 * `stance` after STANCE_DELAY (GDD §5B).
 */
export class MonsterCombatant {
  /** @param {Object} o @param {string} o.playerId @param {string} o.monsterId @param {number[]} [o.skillIds] loadout */
  constructor({ playerId, monsterId, skillIds = [] }) {
    this.playerId = playerId;
    this.monsterId = monsterId;
    const def = getMonster(monsterId);
    this.def = def;
    this.maxHp = def.maxHp;
    this.hp = def.maxHp;
    this.maxStamina = def.maxStamina;
    this.stamina = def.maxStamina;
    this.baseSpeed = def.speed;

    this.stance = STANCES.NEUTRAL;
    this.pendingStance = STANCES.NEUTRAL;
    this._stanceTimer = 0;      // counts down to apply pendingStance

    this.stunTimer = 0;         // >0 → ragdoll stunned
    this.stunCount = 0;         // for the bookmaker "stunned >=3" bet
    this.guardBasicCharges = 0; // basic attacks the defensive stance will negate
    this.confuseTimer = 0;      // >0 → confused wander (spectator tomato, GDD §6)

    this.skillIds = skillIds.slice(0, 4);
    this.cooldowns = new Map(); // skillId -> seconds remaining
    this.alive = true;
  }

  get isStunned() { return this.stunTimer > 0; }
  get isConfused() { return this.confuseTimer > 0; }

  /** Spectator Rotten Tomato on a monster → confused wander for `sec`. */
  applyConfuse(sec) { this.confuseTimer = Math.max(this.confuseTimer, sec); }
  get staminaFraction() { return this.maxStamina > 0 ? this.stamina / this.maxStamina : 0; }

  /** Effective move speed accounting for low-stamina slow + stun. */
  get effectiveSpeed() {
    if (this.isStunned) return 0;
    return this.baseSpeed * (this.staminaFraction < LOW_STAMINA_FRACTION ? LOW_STAMINA_SLOW : 1);
  }

  /** Trainer issues a stance change — applied after the 2.0s delay (GDD §5B). */
  commandStance(stance) {
    if (!Object.values(STANCES).includes(stance)) return;
    if (stance === this.pendingStance) return;
    this.pendingStance = stance;
    this._stanceTimer = STANCE_DELAY;
  }

  /** Seconds remaining before the pending stance takes effect (0 if settled). */
  get stanceDelayRemaining() { return this.pendingStance !== this.stance ? this._stanceTimer : 0; }

  spendStamina(n) {
    this.stamina = Math.max(0, this.stamina - n);
    if (this.stamina === 0 && !this.isStunned) {
      this.stunTimer = STUN_DURATION;
      this.stunCount += 1;
    }
  }

  canCast(skillId) {
    if (this.isStunned || !this.alive) return false;
    if (!this.skillIds.includes(skillId)) return false;
    if ((this.cooldowns.get(skillId) ?? 0) > 0) return false;
    const skill = getSkillById(skillId);
    return this.stamina >= skill.stamina;
  }

  /**
   * Apply incoming damage, honoring defensive mitigation.
   * @param {number} amount
   * @param {Object} [opts]
   * @param {boolean} [opts.isBasic]  basic attack (one can be fully negated while defending)
   * @returns {number} damage actually dealt
   */
  takeDamage(amount, { isBasic = false } = {}) {
    if (!this.alive || amount <= 0) return 0;
    let dmg = amount;
    if (this.stance === STANCES.DEFENSIVE) {
      if (isBasic && this.guardBasicCharges > 0) { this.guardBasicCharges -= 1; return 0; }
      if (!isBasic) dmg = Math.round(dmg * DEFENSIVE_SKILL_MULT);
    }
    this.hp = Math.max(0, this.hp - dmg);
    if (this.hp === 0) this.alive = false;
    return dmg;
  }

  /** Per-tick update: stance delay, stun, cooldowns, stamina regen. */
  update(dt) {
    // Stance delay resolution
    if (this.pendingStance !== this.stance) {
      this._stanceTimer -= dt;
      if (this._stanceTimer <= 0) {
        this.stance = this.pendingStance;
        if (this.stance === STANCES.DEFENSIVE) this.guardBasicCharges = 1; // negate one basic
      }
    }
    // Stun
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      if (this.stunTimer === 0) this.stamina = Math.max(this.stamina, 1); // wake with a sliver
    }
    // Confuse (spectator tomato)
    if (this.confuseTimer > 0) this.confuseTimer = Math.max(0, this.confuseTimer - dt);
    // Cooldowns
    for (const [id, cd] of this.cooldowns) {
      const n = cd - dt;
      if (n <= 0) this.cooldowns.delete(id); else this.cooldowns.set(id, n);
    }
    // Stamina regen (faster while resting/neutral)
    if (!this.isStunned) {
      const rate = this.stance === STANCES.NEUTRAL ? REGEN_REST_PER_SEC : REGEN_COMBAT_PER_SEC;
      this.stamina = Math.min(this.maxStamina, this.stamina + rate * dt);
    }
  }

  startCooldown(skillId) {
    const s = getSkillById(skillId);
    if (s) this.cooldowns.set(skillId, s.cooldown);
  }
}

export const MATCH_STATE = { COUNTDOWN: 'COUNTDOWN', ACTIVE: 'ACTIVE', SUDDEN_DEATH: 'SUDDEN_DEATH', ENDED: 'ENDED' };

/**
 * Orchestrates a 1v1 bout: countdown lock, match clock, Sudden Death, and KO
 * resolution with rewards. Tick with update(dt).
 */
export class CombatMatch {
  /**
   * @param {Object} o
   * @param {MonsterCombatant} o.a
   * @param {MonsterCombatant} o.b
   * @param {number} [o.countdown]  opening lock seconds (default 3)
   * @param {number} [o.clock]      match clock (default debug suddenDeathTimer)
   * @param {(result:object)=>void} [o.onEnd]
   */
  constructor({ a, b, countdown = 3, clock, onEnd }) {
    this.a = a; this.b = b;
    this.onEnd = onEnd;
    this.state = MATCH_STATE.COUNTDOWN;
    this.countdown = countdown;
    this.clock = clock ?? DebugConfig.get('suddenDeathTimer');
    this.elapsed = 0;           // total active seconds (bout duration)
    this.result = null;
  }

  get locked() { return this.state === MATCH_STATE.COUNTDOWN; }

  /** Deal damage through the match so Sudden Death can resolve on first hit. */
  dealDamage(target, amount, opts) {
    if (this.state === MATCH_STATE.ENDED || this.locked) return 0;
    const dealt = target.takeDamage(amount, opts);
    if (dealt > 0 && this.state === MATCH_STATE.SUDDEN_DEATH) {
      this._end(target === this.a ? this.b : this.a, 'sudden_death');
      return dealt;
    }
    if (!target.alive) this._end(target === this.a ? this.b : this.a, 'ko');
    return dealt;
  }

  update(dt) {
    if (this.state === MATCH_STATE.ENDED) return;

    if (this.state === MATCH_STATE.COUNTDOWN) {
      this.countdown -= dt;
      if (this.countdown <= 0) { this.countdown = 0; this.state = MATCH_STATE.ACTIVE; }
      return; // movement/skills frozen during the lock (GDD §5A)
    }

    this.a.update(dt);
    this.b.update(dt);
    this.elapsed += dt;

    if (this.state === MATCH_STATE.ACTIVE) {
      this.clock -= dt;
      if (this.clock <= 0) { this.clock = 0; this.state = MATCH_STATE.SUDDEN_DEATH; }
    }
    // KO is handled in dealDamage; also catch 0-hp from DOT-style effects
    if (!this.a.alive) this._end(this.b, 'ko');
    else if (!this.b.alive) this._end(this.a, 'ko');
  }

  _end(winner, reason) {
    if (this.state === MATCH_STATE.ENDED) return;
    this.state = MATCH_STATE.ENDED;
    const loser = winner === this.a ? this.b : this.a;
    this.result = {
      winnerPlayerId: winner.playerId,
      loserPlayerId: loser.playerId,
      reason,
      boutDurationSec: this.elapsed,
      winReward: DebugConfig.get('winRewardGold'),
      loseReward: DebugConfig.get('loseRewardGold'),
      stunCountsByMonsterId: {
        [this.a.monsterId]: this.a.stunCount,
        [this.b.monsterId]: this.b.stunCount,
      },
    };
    this.onEnd?.(this.result);
  }
}

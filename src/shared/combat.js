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
// Feedback round 1 (#2): stances now switch INSTANTLY; a cooldown starts AFTER
// the switch to prevent spamming (was previously a 2s pre-switch delay).
export const STANCE_COOLDOWN = 2.0;        // seconds locked out after a switch
export const LOW_STAMINA_FRACTION = 0.5;   // below this → slowed
export const LOW_STAMINA_SLOW = 0.7;       // 30% slower → 0.7x speed
export const STUN_DURATION = 3.0;          // 0-stamina ragdoll stun
export const GET_UP_DURATION = 1.0;        // #1 get-up animation (movement locked)
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
    // #8 Monster HP multiplier (debug): scale max + current HP proportionally.
    const hpMult = DebugConfig.multiplier('monsterHpMultiplier');
    this.maxHp = Math.round(def.maxHp * hpMult);
    this.hp = this.maxHp;
    this.maxStamina = def.maxStamina;
    this.stamina = def.maxStamina;
    this.baseSpeed = def.speed;

    this.stance = STANCES.NEUTRAL;
    this.stanceCooldown = 0;    // >0 → cannot switch yet (post-switch lockout, #2)

    this.stunTimer = 0;         // >0 → ragdoll stunned
    this.getUpTimer = 0;        // >0 → playing the Get-Up animation (movement locked, #1)
    this.stunCount = 0;         // for the bookmaker "stunned >=3" bet
    this.guardBasicCharges = 0; // basic attacks the defensive stance will negate
    this.confuseTimer = 0;      // >0 → confused wander (spectator tomato, GDD §6)
    this.moveOrder = null;      // {x,z} trainer click-to-move target (overrides stance)
    this.attackTarget = 'monster'; // #3 'monster' | 'trainer' — who OFFENSIVE chases

    // --- Skill-effect system (fleshed-out skills) ---------------------------
    this.effects = new Map();   // name → { timer, ...params } active timed effects
    this.dots = [];             // [{dps, timer, element}] damage-over-time stacks
    this.shield = null;         // { kind:'immune'|'reflect'|'block', timer }
    this.bide = null;           // { timer, stored } CHARGE_COUNTER accumulator
    this.lastSkillId = null;    // for Encore/Disable
    this.disabledSkillId = null;// Disable: this slot is locked
    this.carriedItem = null;    // for Thief
    this.godMode = false;       // #3 debug: ignore damage + infinite stamina (local only)

    this.skillIds = skillIds.slice(0, 4);
    this.cooldowns = new Map(); // skillId -> seconds remaining
    this.alive = true;
  }

  get isStunned() { return this.stunTimer > 0; }
  get isGettingUp() { return this.getUpTimer > 0; }
  /** #1 True while stunned OR getting up — movement/actions stay locked. */
  get isIncapacitated() { return this.stunTimer > 0 || this.getUpTimer > 0; }
  get isConfused() { return this.confuseTimer > 0; }

  /** Spectator Rotten Tomato on a monster → confused wander for `sec`. */
  applyConfuse(sec) { this.confuseTimer = Math.max(this.confuseTimer, sec); }

  // --- Skill-effect API -----------------------------------------------------
  /** Apply/refresh a named timed status effect (sleep/taunt/slow/vulnerable/...). */
  applyEffect(name, sec, params = {}) { this.effects.set(name, { timer: sec, ...params }); }
  hasEffect(name) { return (this.effects.get(name)?.timer ?? 0) > 0; }
  effectParams(name) { return this.effects.get(name); }

  /** Add a damage-over-time stack. */
  addDot(dps, sec, element = 'Neutral') { this.dots.push({ dps, timer: sec, element }); }

  /** Put up a shield: 'immune' (block all), 'reflect' (bounce projectiles), 'block'. */
  applyShield(kind, sec) { this.shield = { kind, timer: sec }; }
  get isImmune() { return this.shield?.kind === 'immune' && this.shield.timer > 0; }
  get isReflecting() { return this.shield?.kind === 'reflect' && this.shield.timer > 0; }

  /** Sleep / panic / taunt / disable / encore convenience flags. */
  get isAsleep() { return this.hasEffect('sleep'); }
  get isPanicked() { return this.hasEffect('panic'); }
  get isTaunted() { return this.hasEffect('taunt'); }
  /** Endure: HP cannot drop below 1 while active. */
  get isEnduring() { return this.hasEffect('endure'); }
  /** Hover (Fly): immune to ground hazards while active. */
  get isHovering() { return this.hasEffect('hover'); }

  /** Effective speed multiplier from buffs/debuffs (agility/slow). */
  get speedMultiplier() {
    let m = 1;
    if (this.hasEffect('haste')) m *= 2;      // Agility
    if (this.hasEffect('slow')) m *= 0.6;     // Lick / Icy_Wind
    return m;
  }

  /** #3 Set who the Offensive stance pursues: the enemy 'monster' or 'trainer'. */
  setAttackTarget(which) { if (which === 'monster' || which === 'trainer') this.attackTarget = which; }

  /** Trainer LMB click-to-move: walk to {x,z}, overriding stance until reached. */
  setMoveOrder(x, z) { this.moveOrder = { x, z }; }
  /** Cancel a move order (on cast / stance change / arrival). */
  clearMoveOrder() { this.moveOrder = null; }
  get hasMoveOrder() { return this.moveOrder != null; }
  get staminaFraction() { return this.maxStamina > 0 ? this.stamina / this.maxStamina : 0; }

  /** Effective move speed — zero while stunned/getting-up/asleep (#1 + effects). */
  get effectiveSpeed() {
    if (this.isIncapacitated || this.isAsleep) return 0;
    const stam = this.staminaFraction < LOW_STAMINA_FRACTION ? LOW_STAMINA_SLOW : 1;
    return this.baseSpeed * stam * this.speedMultiplier;
  }

  /** Trainer issues a stance change — applied after the 2.0s delay (GDD §5B). */
  /**
   * Trainer issues a stance change (#2 feedback): switches INSTANTLY, then
   * locks out further switches for STANCE_COOLDOWN seconds. Returns true if the
   * switch happened, false if it was on cooldown or a no-op.
   */
  commandStance(stance) {
    if (!Object.values(STANCES).includes(stance)) return false;
    if (stance === this.stance) return false;
    if (this.stanceCooldown > 0) return false; // locked out — prevents spamming
    this.clearMoveOrder(); // changing stance interrupts a click-to-move order
    this.stance = stance;
    if (stance === STANCES.DEFENSIVE) this.guardBasicCharges = 1; // negate one basic
    this.stanceCooldown = STANCE_COOLDOWN;
    return true;
  }

  /** Seconds until the next stance switch is allowed (0 if ready). */
  get stanceCooldownRemaining() { return Math.max(0, this.stanceCooldown); }
  /** Back-compat alias used by HUD: now reports the post-switch lockout. */
  get stanceDelayRemaining() { return 0; }

  spendStamina(n) {
    if (this.godMode) { this.stamina = this.maxStamina; return; } // #3 infinite stamina, no exhaustion stun
    this.stamina = Math.max(0, this.stamina - n);
    if (this.stamina === 0 && !this.isStunned) {
      this.stunTimer = STUN_DURATION;
      this.stunCount += 1;
    }
  }

  canCast(skillId) {
    if (this.isIncapacitated || !this.alive) return false;
    if (this.isAsleep) return false;                       // Yawn
    if (this.disabledSkillId === skillId) return false;    // Disable
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
  takeDamage(amount, { isBasic = false, isProjectile = false } = {}) {
    if (!this.alive || amount <= 0) return 0;
    if (this.godMode) { this.hp = this.maxHp; return 0; } // #3 ignore all damage
    // Withdraw: fully immune. (Reflect handling for projectiles is done by the
    // engine, which checks isReflecting before calling takeDamage.)
    if (this.isImmune) return 0;
    let dmg = amount;
    if (this.stance === STANCES.DEFENSIVE) {
      if (isBasic && this.guardBasicCharges > 0) { this.guardBasicCharges -= 1; return 0; }
      if (!isBasic) dmg = Math.round(dmg * DEFENSIVE_SKILL_MULT);
    }
    // Bide: absorb everything that lands during the charge window.
    if (this.bide && this.bide.timer > 0) { this.bide.stored += dmg; }
    this.hp = Math.max(0, this.hp - dmg);
    // Endure: HP can't drop below 1 while active.
    if (this.isEnduring && this.hp < 1 && amount > 0) this.hp = 1;
    if (this.hp === 0) this.alive = false;
    return dmg;
  }

  /**
   * Round reset (Bo3 #1): restore HP/stamina to full, clear all transient
   * combat state (effects/DoTs/shields/cooldowns/stun/stance), and replenish
   * skill charges. Preserves identity (playerId/monsterId/skillIds) + godMode.
   */
  resetForRound() {
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.alive = true;
    this.stance = STANCES.NEUTRAL;
    this.stanceCooldown = 0;
    this.stunTimer = 0; this.getUpTimer = 0;
    this.confuseTimer = 0;
    this.guardBasicCharges = 0;
    this.moveOrder = null;
    this.attackTarget = 'monster';
    this.effects.clear();
    this.dots = [];
    this.shield = null;
    this.bide = null;
    this.disabledSkillId = null;
    this.cooldowns.clear();  // replenish all skill charges [1]-[4]
  }

  /** Per-tick update: stance cooldown, stun, cooldowns, stamina regen. */
  update(dt) {
    // Stance switch lockout (#2): decays after an instant switch.
    if (this.stanceCooldown > 0) this.stanceCooldown = Math.max(0, this.stanceCooldown - dt);
    // #1 Ragdoll → Get-Up → Active recovery state machine.
    if (this.stunTimer > 0) {
      this.stunTimer = Math.max(0, this.stunTimer - dt);
      if (this.stunTimer === 0) {
        this.stamina = Math.max(this.stamina, 1); // wake with a sliver
        this.getUpTimer = GET_UP_DURATION;        // enter Get-Up (movement stays locked)
      }
    } else if (this.getUpTimer > 0) {
      this.getUpTimer = Math.max(0, this.getUpTimer - dt);
    }
    // Confuse (spectator tomato)
    if (this.confuseTimer > 0) this.confuseTimer = Math.max(0, this.confuseTimer - dt);
    // Cooldowns
    for (const [id, cd] of this.cooldowns) {
      const n = cd - dt;
      if (n <= 0) this.cooldowns.delete(id); else this.cooldowns.set(id, n);
    }
    // Stamina regen (faster while resting/neutral), scaled by the debug
    // staminaRegenMultiplier (#2) — applies to both passive + Neutral rest.
    if (!this.isStunned) {
      const rate = this.stance === STANCES.NEUTRAL ? REGEN_REST_PER_SEC : REGEN_COMBAT_PER_SEC;
      const mult = DebugConfig.multiplier('staminaRegenMultiplier');
      this.stamina = Math.min(this.maxStamina, this.stamina + rate * mult * dt);
    }

    // --- Skill-effect timers --------------------------------------------------
    // Named timed status effects (sleep/taunt/slow/haste/endure/hover/...).
    for (const [name, e] of this.effects) {
      e.timer -= dt;
      if (e.timer <= 0) this.effects.delete(name);
    }
    if (this.disabledSkillId != null && !this.hasEffect('disable')) this.disabledSkillId = null;
    // Damage-over-time stacks (poison/burn). God mode ignores DoT damage (#3).
    if (this.dots.length) {
      for (const d of this.dots) {
        if (!this.godMode) {
          this.hp = Math.max(0, this.hp - d.dps * dt);
          if (this.isEnduring && this.hp < 1) this.hp = 1;
        }
        d.timer -= dt;
      }
      this.dots = this.dots.filter((d) => d.timer > 0);
      if (this.hp === 0) this.alive = false;
    }
    // Shield timer.
    if (this.shield) { this.shield.timer -= dt; if (this.shield.timer <= 0) this.shield = null; }
  }

  startCooldown(skillId) {
    const s = getSkillById(skillId);
    // #8 Skill Cooldown multiplier (debug): scale the cooldown duration.
    if (s) this.cooldowns.set(skillId, s.cooldown * DebugConfig.multiplier('skillCooldownMultiplier'));
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

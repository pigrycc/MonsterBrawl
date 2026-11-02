/**
 * Authoritative combat runner (feedback #2: per-client synchronized combat).
 *
 * The host runs ONE instance of this; it owns the combat sim + simple
 * positional steering (the same stance-driven logic the client scene used) and
 * produces a serializable SNAPSHOT each tick. Non-host clients render snapshots
 * verbatim, so every client sees the identical bout. Physics/ragdoll remain a
 * per-client cosmetic layer driven by these authoritative positions.
 *
 * Kept engine-agnostic (no THREE / no Rapier) so it runs on the Node host and
 * is unit-testable.
 */
import { CombatMatch, MonsterCombatant, STANCES, MATCH_STATE } from './combat.js';
import { getSkillById } from './skills.js';
import { botChooseStance, botChooseSkill } from './bot.js';
import { resolveCast } from './slapstick.js';

const ARENA_R = 22;
const MELEE = 2.4;

export class CombatRunner {
  /**
   * @param {Object} o
   * @param {{playerId,monsterId,skillIds,isBot}} o.a
   * @param {{playerId,monsterId,skillIds,isBot}} o.b
   * @param {(result:object)=>void} [o.onEnd]
   */
  constructor({ a, b, onEnd }) {
    this.aMeta = a; this.bMeta = b;
    this.a = new MonsterCombatant({ playerId: a.playerId, monsterId: a.monsterId, skillIds: a.skillIds });
    this.b = new MonsterCombatant({ playerId: b.playerId, monsterId: b.monsterId, skillIds: b.skillIds });
    this.match = new CombatMatch({ a: this.a, b: this.b, countdown: 3, onEnd: (r) => { this._result = r; onEnd?.(r); } });
    // Positions (authoritative, 2D on the sand).
    this.pos = { a: { x: -8, z: 3 }, b: { x: 8, z: 3 } };
    this.tick = 0;
    this._events = [];       // transient events for this tick (hits/misses/shoves)
    this._botTimers = { a: 0, b: 0 };
  }

  combatantFor(playerId) {
    return this.a.playerId === playerId ? this.a : (this.b.playerId === playerId ? this.b : null);
  }
  _sideOf(playerId) { return this.a.playerId === playerId ? 'a' : 'b'; }

  // --- player intents (relayed from clients) --------------------------------
  cmdStance(playerId, stance) {
    const c = this.combatantFor(playerId);
    if (c && !this.match.locked) c.commandStance(stance);
  }
  cmdCast(playerId, slot) {
    const side = this._sideOf(playerId);
    const c = side === 'a' ? this.a : this.b;
    if (!c || this.match.locked) return;
    const id = c.skillIds[slot];
    if (id == null || !c.canCast(id)) return;
    this._resolveCast(side, id);
  }
  cmdShove(playerId) {
    const side = this._sideOf(playerId);
    const foe = side === 'a' ? 'b' : 'a';
    const d = this._dist();
    if (d <= 3.5) { this._knock(foe, 4); this._events.push({ type: 'shove', target: foe }); }
  }
  /** LMB click-to-move order (overrides stance until reached). */
  cmdMove(playerId, x, z) {
    const c = this.combatantFor(playerId);
    if (c && !this.match.locked) c.setMoveOrder(x, z);
  }

  _resolveCast(side, id) {
    const self = side === 'a' ? this.a : this.b;
    const foe = side === 'a' ? this.b : this.a;
    const skill = getSkillById(id);
    self.clearMoveOrder(); // casting a skill interrupts a click-to-move order
    self.spendStamina(skill.stamina);
    self.startCooldown(id);
    const { hit, reaction } = resolveCast(id, this._dist());
    if (skill.damage > 0) {
      if (hit) {
        const dealt = this.match.dealDamage(foe, skill.damage, { isBasic: false });
        this._events.push({ type: 'hit', target: side === 'a' ? 'b' : 'a', dmg: dealt, skill: id });
      } else {
        this._events.push({ type: 'miss', caster: side, reaction, skill: id });
      }
    } else {
      this._events.push({ type: 'cast', caster: side, skill: id });
    }
  }

  _dist() { return Math.hypot(this.pos.a.x - this.pos.b.x, this.pos.a.z - this.pos.b.z); }
  _knock(side, dist) {
    const other = side === 'a' ? 'b' : 'a';
    const dx = this.pos[side].x - this.pos[other].x, dz = this.pos[side].z - this.pos[other].z;
    const len = Math.hypot(dx, dz) || 1;
    this.pos[side].x += (dx / len) * dist; this.pos[side].z += (dz / len) * dist;
    this._clamp(side);
  }
  _clamp(side) {
    const p = this.pos[side]; const r = Math.hypot(p.x, p.z);
    if (r > ARENA_R - 1) { const s = (ARENA_R - 1) / r; p.x *= s; p.z *= s; }
  }

  // --- host-driven bot sides ------------------------------------------------
  _botThink(side, dt) {
    const self = side === 'a' ? this.a : this.b;
    const foe = side === 'a' ? this.b : this.a;
    self.commandStance(botChooseStance(self, foe));
    this._botTimers[side] -= dt;
    if (this._botTimers[side] <= 0) {
      const id = botChooseSkill(self, this._dist(), 6);
      if (id != null) { this._resolveCast(side, id); this._botTimers[side] = 1.5; }
      else this._botTimers[side] = 0.5;
    }
  }

  _steer(side, dt) {
    const self = side === 'a' ? this.a : this.b;
    if (self.isStunned) return;
    const p = this.pos[side];
    const speed = self.effectiveSpeed;

    // Click-to-move order overrides stance until the point is reached.
    if (self.hasMoveOrder) {
      const mx = self.moveOrder.x - p.x, mz = self.moveOrder.z - p.z;
      const md = Math.hypot(mx, mz);
      if (md <= 1.0) { self.clearMoveOrder(); } // arrived → resume stance
      else { p.x += (mx / md) * speed * dt; p.z += (mz / md) * speed * dt; this._clamp(side); return; }
    }

    const other = side === 'a' ? 'b' : 'a';
    const q = this.pos[other];
    const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d;
    let mx = 0, mz = 0;
    if (self.stance === STANCES.OFFENSIVE) { if (d > MELEE) { mx = nx; mz = nz; } }
    else if (self.stance === STANCES.DEFENSIVE) { if (d < MELEE * 0.8) { mx = -nx; mz = -nz; } }
    else { if (d < MELEE * 2) { mx = -nx; mz = -nz; } }
    if (mx || mz) { p.x += mx * speed * dt; p.z += mz * speed * dt; this._clamp(side); }
  }

  update(dt) {
    this._events = [];
    this.match.update(dt);
    if (this.match.locked || this.match.state === MATCH_STATE.ENDED) { this.tick++; return; }
    // host drives any bot sides
    if (this.aMeta.isBot) this._botThink('a', dt);
    if (this.bMeta.isBot) this._botThink('b', dt);
    this._steer('a', dt);
    this._steer('b', dt);
    this.tick++;
  }

  /** Serializable authoritative snapshot (sent to clients each tick). */
  snapshot() {
    const pack = (c, side) => ({
      hp: Math.round(c.hp), maxHp: c.maxHp,
      stamina: Math.round(c.stamina), maxStamina: c.maxStamina,
      stance: c.stance, stunned: c.isStunned, confused: c.isConfused,
      monsterId: c.monsterId, playerId: c.playerId,
      x: +this.pos[side].x.toFixed(2), z: +this.pos[side].z.toFixed(2),
    });
    return {
      tick: this.tick,
      clock: +this.match.clock.toFixed(2),
      state: this.match.state,
      countdown: +Math.max(0, this.match.countdown).toFixed(2),
      a: pack(this.a, 'a'),
      b: pack(this.b, 'b'),
      events: this._events,
    };
  }

  get ended() { return this.match.state === MATCH_STATE.ENDED; }
  get result() { return this._result; }
}

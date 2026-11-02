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
import { resolveSkill } from './skillEffects.js';
import { TrainerState } from './trainerState.js';
import { DebugConfig } from './debugConfig.js';
import { THROWABLES, THROWABLE_INFO, applyThrowable } from './throwables.js';

const ARENA_R = 22;
const MELEE = 2.4;
const THROW_FLIGHT = 0.8;   // seconds a lobbed throwable is airborne
const THROW_HIT_RADIUS = 2.0;

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
    // #2 Trainer HP + positions (trainers stand behind their monster's spawn).
    this.trainer = { a: new TrainerState(a.playerId), b: new TrainerState(b.playerId) };
    this.trainerPos = { a: { x: -10, z: 9 }, b: { x: 10, z: -9 } };
    this.tick = 0;
    this._events = [];       // transient events for this tick (hits/misses/shoves)
    this._botTimers = { a: 0, b: 0 };
    this._projectiles = [];  // authoritative spectator throwables in flight
    this._projId = 1;
    this._hazards = [];      // persistent field hazards (spikes/ice/clouds/...)
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
  /** #3 Set the reticle attack target ('monster' | 'trainer'). */
  cmdTarget(playerId, target) {
    const c = this.combatantFor(playerId);
    if (c && !this.match.locked) c.setAttackTarget(target);
  }

  /**
   * Authoritative spectator throw: a spectator (not one of the two fighters)
   * lobs a throwable to a target point on the sand. The host spawns the
   * projectile, flies the arc, then resolves the §6 effect on whatever is near
   * the landing — all replicated via snapshots so every client sees it.
   * @param {string} spectatorId
   * @param {string} kind  a THROWABLES value
   * @param {{x:number,z:number}} target  landing point
   */
  cmdSpectatorThrow(spectatorId, kind, target) {
    if (this.match.locked || this.match.state === MATCH_STATE.ENDED) return;
    // Only non-fighters may spectator-throw (fighters use shove/skills).
    if (this.combatantFor(spectatorId)) return;
    if (!THROWABLES[kind] && !Object.values(THROWABLES).includes(kind)) return;
    const K = Object.values(THROWABLES).includes(kind) ? kind : THROWABLES[kind];
    const tx = clampArena(target?.x ?? 0), tz = clampArena(target?.z ?? 0);
    this._projectiles.push({ id: this._projId++, kind: K, from: spectatorId, t: 0, tx, tz });
    this._events.push({ type: 'specThrow', kind: K, x: tx, z: tz });
  }

  _resolveCast(side, id) {
    const self = side === 'a' ? this.a : this.b;
    const foe = side === 'a' ? this.b : this.a;
    const foeSide = side === 'a' ? 'b' : 'a';
    const skill = getSkillById(id);
    self.clearMoveOrder(); // casting a skill interrupts a click-to-move order
    self.spendStamina(skill.stamina);
    self.startCooldown(id);

    // Fleshed-out skill effects: route monster HP loss through the match so
    // Sudden Death still resolves; apply status/buffs/hazards via the engine.
    const res = resolveSkill({
      skillId: id, caster: self, foe, distance: this._dist(),
      dealDamage: (target, amount, opts) => this.match.dealDamage(target, amount, opts),
    });

    // Register any spawned field hazards, anchored to a world position.
    for (const hz of res.hazards) {
      const anchorPos = hz.anchor === 'foe' ? this.pos[foeSide] : this.pos[side];
      this._hazards.push({ ...hz, x: anchorPos.x, z: anchorPos.z });
    }
    // Translate engine events to replicated combat events.
    for (const e of res.events) {
      if (e.kind === 'miss') this._events.push({ type: 'miss', caster: side, skill: id });
      else if (e.kind === 'knockback') this._knock(foeSide, e.distance);
      else if (e.kind === 'knockSelf') this._knock(side, e.distance);
      else if (e.kind === 'teleport') this._applyTeleport(side, e.mode);
      else this._events.push({ type: 'skillfx', caster: side, target: foeSide, skill: id, ...e });
    }
  }

  /** Reposition a monster for a TELEPORT skill. */
  _applyTeleport(side, mode) {
    const p = this.pos[side], other = side === 'a' ? 'b' : 'a', q = this.pos[other];
    if (mode === 'blink' || mode === 'dig') { p.x = q.x; p.z = q.z + (side === 'a' ? -1.5 : 1.5); }
    else if (mode === 'bounce') { p.x = q.x + (Math.random() - 0.5) * 3; p.z = q.z + (Math.random() - 0.5) * 3; }
    this._clamp(side);
  }

  /** Resolve persistent field hazards each tick (entry damage / DoT / pull / slow). */
  _stepHazards(dt) {
    if (!this._hazards?.length) return;
    for (const hz of this._hazards) {
      hz.timer -= dt;
      for (const side of ['a', 'b']) {
        const mon = side === 'a' ? this.a : this.b;
        if (mon.isHovering) continue; // Fly ignores ground hazards
        const p = this.pos[side];
        const inside = Math.hypot(p.x - hz.x, p.z - hz.z) <= hz.radius;
        if (!inside) { hz._inside?.delete?.(side); continue; }
        hz._inside ??= new Set();
        const firstEntry = !hz._inside.has(side);
        hz._inside.add(side);
        if (firstEntry && hz.entryDamage) this.match.dealDamage(mon, hz.entryDamage, {});
        if (firstEntry && hz.dot) mon.addDot(hz.dot.dps, hz.dot.sec, 'Earth');
        if (hz.dps) this.match.dealDamage(mon, hz.dps * dt, {});
        if (hz.status) mon.applyEffect(hz.status.name, hz.status.sec);
        if (hz.pull) { const dx = hz.x - p.x, dz = hz.z - p.z, d = Math.hypot(dx, dz) || 1; p.x += (dx / d) * 1.5 * dt; p.z += (dz / d) * 1.5 * dt; }
      }
    }
    this._hazards = this._hazards.filter((h) => h.timer > 0);
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

  /**
   * Fly authoritative spectator throwables; resolve the §6 effect on landing
   * against whichever monster is within THROW_HIT_RADIUS of the landing point.
   * Emits 'specLand' (+ 'specEffect' on a hit) for client replication.
   */
  _stepProjectiles(dt) {
    if (this._projectiles.length === 0) return;
    const remaining = [];
    for (const p of this._projectiles) {
      p.t += dt;
      if (p.t < THROW_FLIGHT) { remaining.push(p); continue; }
      // landed — find the nearest monster to the landing point
      const da = Math.hypot(p.tx - this.pos.a.x, p.tz - this.pos.a.z);
      const db = Math.hypot(p.tx - this.pos.b.x, p.tz - this.pos.b.z);
      let side = null;
      if (da <= THROW_HIT_RADIUS && da <= db) side = 'a';
      else if (db <= THROW_HIT_RADIUS) side = 'b';
      this._events.push({ type: 'specLand', kind: p.kind, x: p.tx, z: p.tz });
      if (side) {
        const mon = side === 'a' ? this.a : this.b;
        const res = applyThrowable(p.kind, mon, { isMonster: true });
        if (res) this._events.push({ type: 'specEffect', kind: p.kind, target: side, effect: res.effect, durationSec: res.durationSec });
      }
    }
    this._projectiles = remaining;
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
    if (self.isIncapacitated) return; // #1 stunned OR getting up → no movement
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
    const enemyMon = this.pos[other];

    // #3 Offensive target: enemy monster, or the enemy trainer if commanded.
    const chasingTrainer = self.stance === STANCES.OFFENSIVE && self.attackTarget === 'trainer';
    const target = chasingTrainer ? this.trainerPos[other] : enemyMon;
    const dx = target.x - p.x, dz = target.z - p.z, d = Math.hypot(dx, dz) || 1;
    const nx = dx / d, nz = dz / d;

    let mx = 0, mz = 0;
    if (self.stance === STANCES.OFFENSIVE) {
      if (d > MELEE) { mx = nx; mz = nz; }
      else {
        // strike the target on a cadence
        self._basicT = (self._basicT ?? 0) - dt;
        if (self._basicT <= 0 && self.stamina >= 8) {
          self._basicT = 1.2; self.spendStamina(8);
          if (chasingTrainer) {
            const dealt = this.trainer[other].takeDamage(this._basicDmg(self), 'monster');
            this._events.push({ type: 'trainerHit', target: other, dmg: dealt });
          } else {
            const foeC = other === 'a' ? this.a : this.b;
            const dealt = this.match.dealDamage(foeC, this._basicDmg(self), { isBasic: true });
            this._events.push({ type: 'hit', target: other, dmg: dealt });
          }
        }
      }
    } else if (self.stance === STANCES.DEFENSIVE) { if (d < MELEE * 0.8) { mx = -nx; mz = -nz; } }
    else { if (d < MELEE * 2) { mx = -nx; mz = -nz; } }
    if (mx || mz) { p.x += mx * speed * dt; p.z += mz * speed * dt; this._clamp(side); }
  }

  _basicDmg(c) { return getSkillById(c.def.basicAttackSkillId)?.damage ?? 12; }

  update(dt) {
    this._events = [];
    this.match.update(dt);
    if (this.match.locked || this.match.state === MATCH_STATE.ENDED) { this.tick++; return; }
    // host drives any bot sides
    if (this.aMeta.isBot) this._botThink('a', dt);
    if (this.bMeta.isBot) this._botThink('b', dt);
    this._aiTrainerReaction(dt); // #4
    this._steer('a', dt);
    this._steer('b', dt);
    this._aggroInterception();   // #5
    this._stepProjectiles(dt);   // authoritative spectator throwables
    this._stepHazards(dt);       // persistent field hazards (spikes/ice/clouds)
    this.tick++;
  }

  /**
   * #4 AI trainer reaction: when the human monster (a) is in OFFENSIVE stance
   * targeting the bot's trainer (b), the bot trainer waits a configurable delay,
   * then (1) kites away from the approaching monster and (2) commands its own
   * monster to Offensive-target the player's monster to intercept.
   */
  _aiTrainerReaction(dt) {
    if (!this.bMeta.isBot) { this._reactT = 0; return; }
    const beingChased = this.a.stance === STANCES.OFFENSIVE && this.a.attackTarget === 'trainer';
    if (!beingChased) { this._reactT = 0; return; }
    this._reactT = (this._reactT ?? 0) + dt;
    const delay = DebugConfig.get('aiTrainerReactionSeconds');
    if (this._reactT < delay) return; // reaction latency — punish window for the player
    // (1) kite away from the chasing monster
    const t = this.trainerPos.b, m = this.pos.a;
    const dx = t.x - m.x, dz = t.z - m.z, d = Math.hypot(dx, dz) || 1;
    const kite = this.b.baseSpeed * 1.2 * dt; // sprint
    t.x += (dx / d) * kite; t.z += (dz / d) * kite;
    const r = Math.hypot(t.x, t.z); if (r > ARENA_R - 1) { const s = (ARENA_R - 1) / r; t.x *= s; t.z *= s; }
    // (2) retaliate: bot monster goes offensive at the player monster
    this.b.setAttackTarget('monster');
    this.b.commandStance(STANCES.OFFENSIVE);
    if (!this._reactedOnce) { this._reactedOnce = true; this._events.push({ type: 'aiTrainerReact', side: 'b' }); }
  }

  /**
   * #5 Aggro interception (bodyguard): if a monster chasing the enemy TRAINER
   * is in melee contact with the enemy MONSTER, its trainer-focus is broken and
   * it locks back onto the enemy monster.
   */
  _aggroInterception() {
    const contact = this._dist() <= MELEE * 1.1;
    if (!contact) return;
    for (const [side, c] of [['a', this.a], ['b', this.b]]) {
      if (c.stance === STANCES.OFFENSIVE && c.attackTarget === 'trainer') {
        c.setAttackTarget('monster');
        this._events.push({ type: 'intercepted', side });
      }
    }
  }

  /** Serializable authoritative snapshot (sent to clients each tick). */
  snapshot() {
    const pack = (c, side) => ({
      hp: Math.round(c.hp), maxHp: c.maxHp,
      stamina: Math.round(c.stamina), maxStamina: c.maxStamina,
      stance: c.stance, stunned: c.isStunned, gettingUp: c.isGettingUp, confused: c.isConfused,
      attackTarget: c.attackTarget,
      monsterId: c.monsterId, playerId: c.playerId,
      x: +this.pos[side].x.toFixed(2), z: +this.pos[side].z.toFixed(2),
      trainerHp: Math.round(this.trainer[side].hp), trainerMaxHp: this.trainer[side].maxHp,
      trainerX: +this.trainerPos[side].x.toFixed(2), trainerZ: +this.trainerPos[side].z.toFixed(2),
    });
    return {
      tick: this.tick,
      clock: +this.match.clock.toFixed(2),
      state: this.match.state,
      countdown: +Math.max(0, this.match.countdown).toFixed(2),
      a: pack(this.a, 'a'),
      b: pack(this.b, 'b'),
      // in-flight spectator throwables so clients can render the arc
      projectiles: this._projectiles.map((p) => ({ id: p.id, kind: p.kind, t: +p.t.toFixed(3), tx: p.tx, tz: p.tz })),
      hazards: this._hazards.map((h) => ({ kind: h.kind, x: +h.x.toFixed(2), z: +h.z.toFixed(2), radius: h.radius, timer: +h.timer.toFixed(1) })),
      events: this._events,
    };
  }

  get ended() { return this.match.state === MATCH_STATE.ENDED; }
  get result() { return this._result; }
}

/** Clamp a coordinate pair's point to stay inside the arena sand. */
function clampArena(v) { return Math.max(-(ARENA_R - 1), Math.min(ARENA_R - 1, v)); }

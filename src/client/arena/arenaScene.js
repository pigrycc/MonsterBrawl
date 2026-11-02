/**
 * Arena 3D scene + monster movement/AI (GDD §5). The combat *rules* live in
 * src/shared/combat.js; this layer visualizes combatants and moves them around
 * the coliseum sand via simple stance-driven steering (a flat-arena stand-in
 * for NavMesh navigation) with ragdoll-ish stun tilt.
 */
import * as THREE from 'three';
import { createMonster } from '../models/monster.js';
import { STANCES } from '../../shared/combat.js';
import { createTrainer, SKIN_TONES, TUNIC_COLORS } from '../models/trainer.js';

const ARENA_RADIUS = 22;   // #5: grand coliseum footprint (was 13)
const MELEE_RANGE = 2.4;

export class ArenaScene {
  /**
   * @param {Object} o
   * @param {import('../../shared/combat.js').MonsterCombatant} o.a local
   * @param {import('../../shared/combat.js').MonsterCombatant} o.b opponent
   */
  constructor({ a, b }) {
    this.a = a; this.b = b;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x12100c);
    this.scene.fog = new THREE.Fog(0x12100c, 18, 48);

    this._buildArena();
    this._buildCrowd();        // #5 spectator tiers
    // #5 wider spawn separation to suit the grander arena
    this.aView = this._spawnMonster(a, new THREE.Vector3(-8, 0, 3));
    this.bView = this._spawnMonster(b, new THREE.Vector3(8, 0, 3));
    this._buildTrainers();     // #5 visible local + opponent trainers
    this.drops = []; // {mesh, kind}
  }

  _buildArena() {
    const sand = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS, 56),
      new THREE.MeshStandardMaterial({ color: 0xcdb892, roughness: 1.0 })
    );
    sand.rotation.x = -Math.PI / 2; sand.receiveShadow = true;
    this.scene.add(sand);

    // Coliseum wall ring (taller for the grand scale) + tiered stands behind it
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b5d45, roughness: 0.9, flatShading: true });
    const WALL_H = 4.5;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS + 0.5, ARENA_RADIUS + 0.5, WALL_H, 48, 1, true), wallMat);
    wall.position.y = WALL_H / 2; wall.material.side = THREE.BackSide;
    this.scene.add(wall);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.7, WALL_H + 1.5, 0.7), wallMat);
      pillar.position.set(Math.cos(a) * (ARENA_RADIUS + 0.9), (WALL_H + 1.5) / 2, Math.sin(a) * (ARENA_RADIUS + 0.9));
      this.scene.add(pillar);
    }
    // Three tiered stone stands rising behind the wall.
    const standMat = new THREE.MeshStandardMaterial({ color: 0x5a4f3c, roughness: 0.95, flatShading: true });
    for (let tier = 0; tier < 3; tier++) {
      const r = ARENA_RADIUS + 2 + tier * 2.2;
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1.4, 48, 1, true), standMat);
      ring.position.y = WALL_H + tier * 1.4 + 0.7; ring.material.side = THREE.DoubleSide;
      this.scene.add(ring);
    }

    // Bright arena lighting (midday coliseum), shadow frustum sized to the arena.
    this.scene.add(new THREE.AmbientLight(0xfff2d8, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(12, 30, 10); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -ARENA_RADIUS; sun.shadow.camera.right = ARENA_RADIUS;
    sun.shadow.camera.top = ARENA_RADIUS; sun.shadow.camera.bottom = -ARENA_RADIUS;
    this.scene.add(sun);
  }

  /** #5 Populate the stands with stylized low-poly spectator heads. */
  _buildCrowd() {
    const headGeo = new THREE.IcosahedronGeometry(0.28, 0);
    const palette = [0xf1c9a5, 0xc68642, 0x8d5524, 0xe0ac86, 0x5c3a21];
    const crowd = new THREE.Group();
    this._crowdHeads = [];
    for (let tier = 0; tier < 3; tier++) {
      const r = ARENA_RADIUS + 2 + tier * 2.2;
      const y = 4.5 + tier * 1.4 + 1.1;
      const count = Math.floor(2 * Math.PI * r / 1.1);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + (tier * 0.2);
        const mat = new THREE.MeshStandardMaterial({ color: palette[(i + tier) % palette.length], flatShading: true });
        const head = new THREE.Mesh(headGeo, mat);
        head.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
        head.userData.baseY = y;
        head.userData.phase = Math.random() * Math.PI * 2;
        crowd.add(head);
        this._crowdHeads.push(head);
      }
    }
    this.scene.add(crowd);
  }

  /**
   * #5 Visible OPPONENT trainer on the far side. The local trainer is NOT
   * rendered as a body in front of the camera — in first person the player IS
   * the trainer (represented by the FPP viewmodel hand), so a body mesh would
   * just block the view.
   */
  _buildTrainers() {
    this.oppTrainer = createTrainer({ skinTone: SKIN_TONES[3], tunicColor: TUNIC_COLORS[0], name: 'Opponent' });
    this.oppTrainer.position.set(10, 0, -9);   // opposite side (GDD #5)
    this.oppTrainer.rotation.y = Math.PI - 0.4;
    this.scene.add(this.oppTrainer);
  }

  _spawnMonster(combatant, pos) {
    const mesh = createMonster(combatant.def);
    mesh.position.copy(pos);
    const baseScale = 1.2;
    mesh.scale.setScalar(baseScale);
    this.scene.add(mesh);
    return {
      mesh, combatant,
      pos: pos.clone(),
      facing: 0,
      baseScale,
      _basicTimer: 0,
      _hitFlash: 0,
      _moving: false,
      _gait: 0,
    };
  }

  /** Spawn a crowd-drop item at a random arena position (GDD §5C). */
  spawnDrop(kind) {
    const colors = { potion: 0xe0484d, adrenaline: 0x3fd0a0, oil: 0x2a2a2a };
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.3, 0),
      new THREE.MeshStandardMaterial({ color: colors[kind] ?? 0xffffff, emissive: colors[kind] ?? 0, emissiveIntensity: 0.25, flatShading: true })
    );
    const a = Math.random() * Math.PI * 2, r = Math.random() * (ARENA_RADIUS - 3);
    mesh.position.set(Math.cos(a) * r, 0.4, Math.sin(a) * r);
    mesh.castShadow = true;
    this.scene.add(mesh);
    const drop = { mesh, kind };
    this.drops.push(drop);
    return drop;
  }

  removeDrop(drop) {
    const i = this.drops.indexOf(drop);
    if (i >= 0) this.drops.splice(i, 1);
    this.scene.remove(drop.mesh);
  }

  /**
   * Spawn a flying spectator throwable that arcs from the stands to a target
   * point on the sand (GDD §6). Returns a projectile handle the phase ticks.
   * @param {number} color
   * @param {THREE.Vector3} target  landing point on the arena
   */
  spawnThrowable(color, target) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 0),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3, flatShading: true })
    );
    // Launch from a random point on the elevated stands (just outside the wall).
    const a = Math.atan2(target.z, target.x) + (Math.random() - 0.5);
    const start = new THREE.Vector3(Math.cos(a) * (ARENA_RADIUS + 0.5), 3.5, Math.sin(a) * (ARENA_RADIUS + 0.5));
    mesh.position.copy(start);
    this.scene.add(mesh);
    const proj = { mesh, start, target: target.clone(), t: 0, dur: 0.8, done: false };
    (this._projectiles ??= []).push(proj);
    return proj;
  }

  /** Advance projectiles; returns landed ones [{pos}] for effect resolution. */
  _stepProjectiles(dt) {
    const landed = [];
    const list = this._projectiles ?? [];
    for (const p of list) {
      if (p.done) continue;
      p.t += dt / p.dur;
      if (p.t >= 1) {
        p.mesh.position.copy(p.target);
        p.done = true;
        landed.push({ pos: p.target.clone(), kind: p.kind });
        this.scene.remove(p.mesh);
      } else {
        // parabolic arc
        p.mesh.position.lerpVectors(p.start, p.target, p.t);
        p.mesh.position.y += Math.sin(p.t * Math.PI) * 3.0;
        p.mesh.rotation.x += dt * 8; p.mesh.rotation.y += dt * 6;
      }
    }
    if (list.length) this._projectiles = list.filter((p) => !p.done);
    return landed;
  }

  /** World position of a monster view, for landing-proximity checks. */
  monsterPos(which) { return (which === 'a' ? this.aView : this.bView).pos; }

  /** Flash a monster red when it takes damage. */
  flashHit(which) { (which === 'a' ? this.aView : this.bView)._hitFlash = 0.25; }

  /**
   * Move monsters per their stance each tick. Returns basic-attack events the
   * caller should resolve into damage: [{attacker:'a'|'b'}].
   * @param {number} dt
   * @param {boolean} locked  true during the countdown (no movement)
   */
  update(dt, locked) {
    const events = [];
    const landed = this._stepProjectiles(dt); // throwables fly even during lock
    if (locked) { this._animate(dt); this._animateCrowdAndTrainers(dt); return { events, landed }; }
    this._stepMonster(this.aView, this.bView, dt, events, 'a');
    this._stepMonster(this.bView, this.aView, dt, events, 'b');
    this._animate(dt);
    this._animateCrowdAndTrainers(dt);
    return { events, landed };
  }

  _stepMonster(self, foe, dt, events, tag) {
    const c = self.combatant;
    // stun → tilt the mesh like a ragdoll, no movement
    if (c.isStunned) { self.mesh.rotation.z = Math.sin(performance.now() * 0.02) * 0.5; return; }
    self.mesh.rotation.z *= 0.8;

    // Confused wander (spectator Rotten Tomato, GDD §6): move in a drifting
    // random direction instead of toward/away from the foe.
    if (c.isConfused) {
      if (self._wanderDir == null || (self._wanderT = (self._wanderT ?? 0) - dt) <= 0) {
        const a = Math.random() * Math.PI * 2;
        self._wanderDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        self._wanderT = 0.6;
      }
      self.pos.addScaledVector(self._wanderDir, c.effectiveSpeed * 0.6 * dt);
      const r = Math.hypot(self.pos.x, self.pos.z);
      if (r > ARENA_RADIUS - 1) { const s = (ARENA_RADIUS - 1) / r; self.pos.x *= s; self.pos.z *= s; }
      self.facing += dt * 3; // spin while dazed
      return;
    }

    const toFoe = new THREE.Vector3().subVectors(foe.pos, self.pos);
    const dist = toFoe.length();
    toFoe.normalize();
    const speed = c.effectiveSpeed;

    let move = new THREE.Vector3();
    if (c.stance === STANCES.OFFENSIVE) {
      // Close distance; when in melee range, strike on a cadence.
      if (dist > MELEE_RANGE) move.copy(toFoe);
      else {
        self._basicTimer -= dt;
        if (self._basicTimer <= 0) {
          self._basicTimer = 1.2;
          if (c.stamina >= 8) { c.spendStamina(8); events.push({ attacker: tag }); }
        }
      }
    } else if (c.stance === STANCES.DEFENSIVE) {
      // Hold ground; back off a touch if foe is very close.
      if (dist < MELEE_RANGE * 0.8) move.copy(toFoe).multiplyScalar(-1);
    } else {
      // NEUTRAL/REST: disengage to a comfortable distance.
      if (dist < MELEE_RANGE * 2) move.copy(toFoe).multiplyScalar(-1);
    }

    self._moving = move.lengthSq() > 0;
    if (self._moving) {
      self.pos.addScaledVector(move.normalize(), speed * dt);
    }
    this._clampToArena(self); // #6 hard boundary every frame
    self.facing = Math.atan2(toFoe.x, toFoe.z);
  }

  /**
   * #6 Out-of-bounds fail-safe: clamp a monster strictly inside the arena every
   * frame. If a high-impulse shove/ragdoll flings it past the perimeter, it's
   * snapped back onto the sand rather than escaping through the wall.
   */
  _clampToArena(view) {
    const limit = ARENA_RADIUS - 1;
    const r = Math.hypot(view.pos.x, view.pos.z);
    if (r > limit) {
      const s = limit / r;
      view.pos.x *= s; view.pos.z *= s;
      view._wanderDir = null; // break any wander pushing it outward
    }
  }

  _animate(dt) {
    for (const v of [this.aView, this.bView]) {
      const c = v.combatant;
      this._clampToArena(v); // belt-and-suspenders boundary enforcement (#6)
      const yBase = c.def.silhouette === 'raptor_hover' ? 0.3 : 0;

      // #4 Locomotion juice: squash-and-stretch bob + side roll while moving.
      let bobY = 0, roll = 0, squash = 1;
      if (v._moving && !c.isStunned) {
        v._gait = (v._gait ?? 0) + dt * 10 * (c.effectiveSpeed / (c.baseSpeed || 1));
        bobY = Math.abs(Math.sin(v._gait)) * 0.14;              // vertical hop
        roll = Math.sin(v._gait * 0.5) * 0.12;                  // side-to-side tilt
        squash = 1 + Math.sin(v._gait) * 0.06;                  // stretch on the up-beat
      } else {
        v._gait = (v._gait ?? 0) + dt * 2;
        bobY = Math.sin(v._gait) * 0.03;                         // gentle idle breathe
      }

      v.mesh.position.set(v.pos.x, yBase + bobY, v.pos.z);
      v.mesh.rotation.y = v.facing;
      // keep stun ragdoll tilt if present; otherwise apply locomotion roll
      if (!c.isStunned) v.mesh.rotation.z = roll;
      const base = v.baseScale ?? 1;
      v.mesh.scale.y = base * squash;
      v.mesh.scale.x = v.mesh.scale.z = base * (2 - squash); // conserve volume a touch

      if (v._hitFlash > 0) {
        v._hitFlash -= dt;
        v.mesh.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(v._hitFlash > 0 ? 0x661111 : 0x000000); });
      }
    }
  }

  /** #5 Bob the crowd (cheering) and make the opponent trainer gesture. */
  _animateCrowdAndTrainers(dt) {
    this._t = (this._t ?? 0) + dt;
    const t = this._t;
    if (this._crowdHeads) {
      for (const h of this._crowdHeads) {
        h.position.y = h.userData.baseY + Math.abs(Math.sin(t * 3 + h.userData.phase)) * 0.18;
      }
    }
    // Opponent trainer faces/gestures toward its monster; local trainer idles.
    if (this.oppTrainer && this.bView) {
      const dx = this.bView.pos.x - this.oppTrainer.position.x;
      const dz = this.bView.pos.z - this.oppTrainer.position.z;
      this.oppTrainer.rotation.y = Math.atan2(dx, dz);
      const arm = this.oppTrainer.userData.parts?.armR;
      if (arm) arm.rotation.x = -1.2 + Math.sin(t * 6) * 0.3; // waving/pointing
    }
  }

  get arenaRadius() { return ARENA_RADIUS; }
  get meleeRange() { return MELEE_RANGE; }
}

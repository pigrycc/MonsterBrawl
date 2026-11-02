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
import { PhysicsWorld, isRapierReady } from '../physics/physicsWorld.js';
import { THROWABLES, THROWABLE_INFO } from '../../shared/throwables.js';

const ARENA_RADIUS = 22;   // #5: grand coliseum footprint (was 13)
/** #1 Throwable mesh colors for rendering authoritative spectator projectiles. */
const THROWABLE_COLOR = {
  [THROWABLES.ROTTEN_TOMATO]: THROWABLE_INFO.ROTTEN_TOMATO.color,
  [THROWABLES.STONE]: THROWABLE_INFO.STONE.color,
  [THROWABLES.SPEED_DRAFT]: THROWABLE_INFO.SPEED_DRAFT.color,
};
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
    this._buildTrainers();     // #5 visible opponent trainer
    this.drops = []; // {mesh, kind}

    // #1 Physics: if Rapier is loaded, create a physics world with solid walls
    // and dynamic bodies for both monsters. Movement then runs on rigid bodies
    // with real impulses + tumble ragdoll. If not ready yet, we fall back to
    // the steering+clamp path (still correct, just no rigid-body collisions).
    this.physics = null;
    if (isRapierReady()) {
      try {
        this.physics = new PhysicsWorld({ radius: ARENA_RADIUS });
        this.physics.addMonster('a', this.aView.pos, this.aView.combatant.maxHp / 120 + 0.5);
        this.physics.addMonster('b', this.bView.pos, this.bView.combatant.maxHp / 120 + 0.5);
      } catch (e) {
        console.warn('[MCB] physics init failed, using steering fallback:', e?.message);
        this.physics = null;
      }
    }
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
    // #2 Overhead world-space HP bar above the opponent trainer.
    this.oppTrainerBar = this._makeOverheadBar();
    this.oppTrainerBar.position.set(0, 2.1, 0);
    this.oppTrainer.add(this.oppTrainerBar);
  }

  /** #2 A small billboarded red/green HP bar (background + fill) for overhead use. */
  _makeOverheadBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.18), new THREE.MeshBasicMaterial({ color: 0x1a2233, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.12), new THREE.MeshBasicMaterial({ color: 0x39d98a, depthTest: false }));
    fill.position.z = 0.01; fill.renderOrder = 999; bg.renderOrder = 998;
    g.add(bg, fill);
    g.userData.fill = fill;
    return g;
  }

  /** Billboard the overhead bar to face the camera (called each frame). */
  _billboardBars(camera) {
    if (this.oppTrainerBar && camera) this.oppTrainerBar.lookAt(camera.position);
  }

  /** #2 Set the opponent trainer's overhead HP fraction (0..1). */
  setOppTrainerHp(frac) {
    const fill = this.oppTrainerBar?.userData.fill;
    if (!fill) return;
    const f = Math.max(0, Math.min(1, frac));
    fill.scale.x = f || 0.001;
    fill.position.x = -(1.14 / 2) * (1 - f); // left-anchor the shrink
    fill.material.color.setHex(f > 0.3 ? 0x39d98a : 0xef4444);
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

  /** World position of the opponent trainer (for #3 trainer-targeting). */
  get oppTrainerPos() { return this.oppTrainer ? this.oppTrainer.position : null; }

  /**
   * #3 Raycast the crosshair against the enemy monster + enemy trainer. Returns
   * 'monster' | 'trainer' | null and highlights the hovered target with a
   * reticle outline (red = monster, orange = trainer).
   */
  reticleTarget(camera) {
    this._reticleRay ??= new THREE.Raycaster();
    this._reticleRay.setFromCamera({ x: 0, y: 0 }, camera);
    // enemy = the 'b' side monster + the opponent trainer mesh
    const monMeshes = []; this.bView.mesh.traverse((o) => { if (o.isMesh) monMeshes.push(o); });
    const trnMeshes = []; this.oppTrainer?.traverse((o) => { if (o.isMesh) trnMeshes.push(o); });
    const monHit = this._reticleRay.intersectObjects(monMeshes, false)[0];
    const trnHit = this._reticleRay.intersectObjects(trnMeshes, false)[0];
    let target = null;
    if (monHit && (!trnHit || monHit.distance <= trnHit.distance)) target = 'monster';
    else if (trnHit) target = 'trainer';
    this._applyReticleHighlight(target);
    return target;
  }

  _applyReticleHighlight(target) {
    // tint the enemy monster / opponent trainer emissive to confirm the hover
    const setEmissive = (root, hex) => root?.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(hex); });
    setEmissive(this.bView.mesh, target === 'monster' ? 0x661111 : 0x000000);
    setEmissive(this.oppTrainer, target === 'trainer' ? 0x663a00 : 0x000000);
  }

  /**
   * Click-to-move raycast: project screen-center (crosshair) onto the sand
   * plane (y=0) and return the {x,z} ground point, clamped inside the arena,
   * or null if aimed at the sky.
   */
  groundPointUnderCrosshair(camera) {
    this._ray ??= new THREE.Raycaster();
    this._groundPlane ??= new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._ray.setFromCamera({ x: 0, y: 0 }, camera);
    const hit = new THREE.Vector3();
    if (!this._ray.ray.intersectPlane(this._groundPlane, hit)) return null;
    const r = Math.hypot(hit.x, hit.z);
    const lim = ARENA_RADIUS - 1;
    if (r > lim) { const s = lim / r; hit.x *= s; hit.z *= s; }
    return { x: hit.x, z: hit.z };
  }

  /**
   * #1 Shove/knockback a monster a given distance in a direction. Uses a real
   * physics impulse when available; otherwise moves the position directly.
   */
  knockback(which, dir, distance) {
    const v = which === 'a' ? this.aView : this.bView;
    const n = { x: dir.x, z: dir.z };
    const len = Math.hypot(n.x, n.z) || 1; n.x /= len; n.z /= len;
    if (this.physics) {
      this.physics.applyImpulse(which, n.x * distance * 6, 2, n.z * distance * 6);
    } else {
      v.pos.x += n.x * distance; v.pos.z += n.z * distance;
      this._clampToArena(v);
    }
  }

  /**
   * #2 Networked (synced) mode: apply an authoritative snapshot from the host.
   * Positions/HP/stamina/stance come from the server; the local sim is NOT run.
   * Physics/ragdoll stay cosmetic — we lerp bodies toward the authoritative pos.
   */
  applySnapshot(snap) {
    this._synced = true;
    const map = (sideView, s) => {
      sideView.pos.set(s.x, 0, s.z);
      // mirror authoritative combat state onto the local combatant for the HUD
      const c = sideView.combatant;
      c.hp = s.hp; c.stamina = s.stamina; c.stance = s.stance;
      c.stunTimer = s.stunned ? Math.max(c.stunTimer, 0.1) : 0;
      c.getUpTimer = s.gettingUp ? Math.max(c.getUpTimer, 0.1) : (s.stunned ? c.getUpTimer : 0); // #1 sync get-up
      c.confuseTimer = s.confused ? Math.max(c.confuseTimer, 0.1) : 0;
    };
    map(this.aView, snap.a);
    map(this.bView, snap.b);
    // #2 opponent trainer position + overhead HP from the authoritative snapshot
    if (this.oppTrainer && snap.b.trainerX != null) {
      this.oppTrainer.position.set(snap.b.trainerX, 0, snap.b.trainerZ);
      this.setOppTrainerHp((snap.b.trainerHp ?? 100) / (snap.b.trainerMaxHp ?? 100));
    }
    this._snapTrainer = { a: snap.a, b: snap.b }; // for HUD readout
    if (this.physics) {
      this.physics.setPosition('a', snap.a.x, 1.0, snap.a.z);
      this.physics.setPosition('b', snap.b.x, 1.0, snap.b.z);
    }
    // surface events the host decided
    for (const ev of snap.events || []) {
      if (ev.type === 'miss') this.playReaction(ev.caster, ev.reaction);
      if (ev.type === 'hit' || ev.type === 'trainerHit') this.flashHit(ev.target === 'a' || ev.target === 'b' ? ev.target : 'b');
      // authoritative spectator-throw effect landed on a monster
      if (ev.type === 'specEffect') this.flashHit(ev.target);
    }
    // #1 Render authoritative spectator throwables arcing in from the stands.
    this._renderAuthProjectiles(snap.projectiles || []);
  }

  /**
   * Draw the host's in-flight spectator throwables. Each has a stable id; we
   * reuse meshes across frames and lerp them along a parabolic arc from a point
   * on the stands to the authoritative landing (tx,tz). Flight fraction = t/0.8.
   */
  _renderAuthProjectiles(projs) {
    this._authProj ??= new Map();
    const seen = new Set();
    for (const p of projs) {
      seen.add(p.id);
      let mesh = this._authProj.get(p.id);
      if (!mesh) {
        const color = THROWABLE_COLOR[p.kind] ?? 0xffffff;
        mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.25, 0), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4, flatShading: true }));
        // launch origin: a point on the stands beyond the landing bearing
        const a = Math.atan2(p.tz, p.tx);
        mesh.userData.start = { x: Math.cos(a) * (ARENA_RADIUS + 1), z: Math.sin(a) * (ARENA_RADIUS + 1) };
        this.scene.add(mesh);
        this._authProj.set(p.id, mesh);
      }
      const frac = Math.min(1, p.t / 0.8);
      const s = mesh.userData.start;
      mesh.position.set(
        s.x + (p.tx - s.x) * frac,
        3.5 + (0.3 - 3.5) * frac + Math.sin(frac * Math.PI) * 3.0,
        s.z + (p.tz - s.z) * frac
      );
      mesh.rotation.x += 0.3; mesh.rotation.y += 0.2;
    }
    // remove meshes for projectiles that have landed/disappeared
    for (const [id, mesh] of this._authProj) {
      if (!seen.has(id)) { this.scene.remove(mesh); this._authProj.delete(id); }
    }
  }

  dispose() { this.physics?.dispose?.(); }

  /** Flash a monster red when it takes damage. */
  flashHit(which) { (which === 'a' ? this.aView : this.bView)._hitFlash = 0.25; }

  /**
   * #3 Trigger a slapstick miss reaction on a monster's view. The reaction is a
   * timed physical animation (see _animateReaction). `reaction` is a REACTION
   * value from src/shared/slapstick.js.
   */
  playReaction(which, reaction) {
    const v = which === 'a' ? this.aView : this.bView;
    v._reaction = reaction;
    v._reactionT = 0;
    v._reactionDur = reaction === 'PINBALL' ? 1.5 : 1.1; // #2 longer, more readable timing
    v._reactionCued = false; v._recoilLanded = false;    // #2 reset one-shot cues
    // Capture a launch direction for recoil/pinball (away from the foe).
    const foe = which === 'a' ? this.bView : this.aView;
    const away = new THREE.Vector3(v.pos.x - foe.pos.x, 0, v.pos.z - foe.pos.z);
    v._reactionDir = away.lengthSq() > 0 ? away.normalize() : new THREE.Vector3(1, 0, 0);
  }

  /**
   * Move monsters per their stance each tick. Returns basic-attack events the
   * caller should resolve into damage: [{attacker:'a'|'b'}].
   * @param {number} dt
   * @param {boolean} locked  true during the countdown (no movement)
   */
  update(dt, locked) {
    const events = [];
    const landed = this._stepProjectiles(dt); // throwables fly even during lock
    if (locked) {
      if (this.physics) this.physics.step(dt);
      this._syncFromPhysics();
      this._animate(dt); this._animateCrowdAndTrainers(dt); this._stepDust(dt);
      return { events, landed };
    }
    this._stepMonster(this.aView, this.bView, dt, events, 'a');
    this._stepMonster(this.bView, this.aView, dt, events, 'b');
    if (this.physics) { this.physics.step(dt); this._syncFromPhysics(); }
    this._animate(dt);
    this._animateCrowdAndTrainers(dt);
    this._stepDust(dt); // #2 slapstick dust puffs
    return { events, landed };
  }

  _stepMonster(self, foe, dt, events, tag) {
    const c = self.combatant;
    // stun → tilt the mesh like a ragdoll, no movement. Get-up also locks
    // movement (handled visually in _animate), so bail out of steering here too.
    if (c.isStunned) { self.mesh.rotation.z = Math.sin(performance.now() * 0.02) * 0.5; self._moving = false; return; }
    if (c.isGettingUp) { self._moving = false; return; }
    self.mesh.rotation.z *= 0.8;

    // Click-to-move order (LMB): walk to the point, overriding stance, until
    // reached; then clear and resume normal stance behavior.
    if (c.hasMoveOrder) {
      const mx = c.moveOrder.x - self.pos.x, mz = c.moveOrder.z - self.pos.z;
      const md = Math.hypot(mx, mz);
      self._moving = md > 1.0;
      if (!self._moving) { c.clearMoveOrder(); }
      else {
        const key = self === this.aView ? 'a' : 'b';
        const spd = c.effectiveSpeed;
        if (this.physics && !self._reaction) {
          this.physics.setDesiredVelocity(key, (mx / md) * spd, (mz / md) * spd);
        } else {
          self.pos.x += (mx / md) * spd * dt; self.pos.z += (mz / md) * spd * dt; this._clampToArena(self);
        }
        self.facing = Math.atan2(mx, mz);
        return;
      }
    }

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

    // #3 Offensive pursuit target: the enemy monster, or the enemy trainer if
    // the trainer issued a trainer-attack command. Only side 'a' can target the
    // (visible) opponent trainer; side 'b' always targets the player monster.
    const trainerTarget = (c.stance === STANCES.OFFENSIVE && c.attackTarget === 'trainer' && tag === 'a' && this.oppTrainerPos);
    const targetPos = trainerTarget ? this.oppTrainerPos : foe.pos;
    const toFoe = new THREE.Vector3().subVectors(targetPos, self.pos); toFoe.y = 0;
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
          if (c.stamina >= 8) { c.spendStamina(8); events.push({ attacker: tag, vsTrainer: !!trainerTarget }); }
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
    const key = self === this.aView ? 'a' : 'b';

    if (this.physics && !self._reaction) {
      // Physics mode: drive the rigid body toward the desired velocity. The
      // wall colliders stop it escaping — no manual clamp needed.
      if (self._moving) {
        move.normalize().multiplyScalar(speed);
        this.physics.setDesiredVelocity(key, move.x, move.z);
      } else {
        this.physics.setDesiredVelocity(key, 0, 0);
      }
    } else if (self._moving) {
      self.pos.addScaledVector(move.normalize(), speed * dt);
      this._clampToArena(self); // fallback boundary
    }
    self.facing = Math.atan2(toFoe.x, toFoe.z);
  }

  /**
   * #1 Pull rigid-body transforms into the render views, and drive stun↔ragdoll
   * transitions: a freshly-stunned monster tumbles (ragdoll); on recovery it
   * stands back up.
   */
  _syncFromPhysics() {
    if (!this.physics) return;
    for (const [key, v] of [['a', this.aView], ['b', this.bView]]) {
      const c = v.combatant;

      // #1 Recovery state machine: RAGDOLL (stunned) → GET_UP (upright, locked,
      // realigned to ground, playing the get-up anim) → ACTIVE.
      if (c.isStunned && !v._ragdolling) {
        // enter ragdoll tumble
        v._ragdolling = true; v._gettingUp = false;
        const foe = key === 'a' ? this.bView : this.aView;
        const away = { x: v.pos.x - foe.pos.x, z: v.pos.z - foe.pos.z };
        const len = Math.hypot(away.x, away.z) || 1;
        this.physics.ragdoll(key, { x: away.x / len, z: away.z / len });
      } else if (!c.isStunned && v._ragdolling) {
        // stun ended → stand the body up (kinematic realign) and begin GET_UP.
        v._ragdolling = false; v._gettingUp = true;
        this.physics.standUp(key);               // re-lock upright + zero spin
        v._physRot = null;                        // stop driving mesh from tumble quaternion
      } else if (v._gettingUp && !c.isGettingUp) {
        // get-up animation finished → fully active again
        v._gettingUp = false;
      }

      // Keep the body planted (no outward velocity) during get-up so it can't
      // slide while the animation plays.
      if (v._gettingUp) this.physics.setDesiredVelocity(key, 0, 0);

      const t = this.physics.getTransform(key);
      if (t) {
        v.pos.set(t.pos.x, 0, t.pos.z);
        if (v._ragdolling) v._physRot = t.rot;   // only read tumble rotation while ragdolling
      }
    }
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

      // #3 Slapstick miss reaction takes over the animation while active.
      if (v._reaction && v._reactionT < v._reactionDur) {
        this._animateReaction(v, dt);
        continue;
      } else if (v._reaction) {
        v._reaction = null; // reaction finished → restore normal pose below
        v.mesh.rotation.set(0, v.facing, 0);
      }

      // #1 Physics ragdoll: while tumbling, drive the mesh directly from the
      // rigid body's full orientation (free rotation) + height.
      if (v._ragdolling && v._physRot) {
        const t = this.physics.getTransform(v === this.aView ? 'a' : 'b');
        v.mesh.position.set(t.pos.x, Math.max(0.2, t.pos.y), t.pos.z);
        v.mesh.quaternion.set(t.rot.x, t.rot.y, t.rot.z, t.rot.w);
        const base = v.baseScale ?? 1; v.mesh.scale.set(base, base, base);
        continue;
      }

      const yBaseEarly = c.def.silhouette === 'raptor_hover' ? 0.3 : 0;
      // #1 Get-Up animation: smoothly rise from flat (on the ground) back to
      // upright over the get-up duration. Movement is locked (effectiveSpeed=0)
      // so this can't slide. Uses quaternion slerp from a prone tilt → upright.
      if (c.isGettingUp) {
        const p = 1 - (c.getUpTimer / 1.0); // 0 (just stood up) → 1 (fully up)
        const base = v.baseScale ?? 1;
        const proneTilt = new THREE.Euler(Math.PI / 2 * (1 - p), v.facing, 0, 'YXZ');
        v.mesh.quaternion.setFromEuler(proneTilt);
        v.mesh.position.set(v.pos.x, yBaseEarly + p * 0.0, v.pos.z);
        v.mesh.scale.set(base, base, base);
        continue;
      }

      if (!this.physics) this._clampToArena(v); // fallback boundary (physics walls handle it otherwise)
      // reset any leftover quaternion from ragdoll/get-up back to Euler control
      v.mesh.quaternion.set(0, 0, 0, 1);
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

  /** #3 Animate an in-progress slapstick miss reaction for one monster view. */
  _animateReaction(v, dt) {
    v._reactionT += dt;
    const p = Math.min(1, v._reactionT / v._reactionDur); // 0..1 progress
    const base = v.baseScale ?? 1;
    const dir = v._reactionDir;
    const yBase = v.combatant.def.silhouette === 'raptor_hover' ? 0.3 : 0;
    v.mesh.scale.set(base, base, base);
    v.mesh.rotation.set(0, v.facing, 0);

    // Fire one-shot cues exactly once as the reaction begins.
    const firstFrame = !v._reactionCued; if (firstFrame) v._reactionCued = true;
    // Easing helpers for juicier motion.
    const easeOutBack = (x) => { const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
    const bounce = (x) => Math.abs(Math.sin(x * Math.PI * 2.5)) * (1 - x); // damped bounces

    switch (v._reaction) {
      case 'TRIP': {
        // anticipation: brief wind-back, then an exaggerated forward faceplant + skid + dust.
        const anticip = p < 0.15 ? -(0.15 - p) * 2 : 0; // small lean back first
        const fall = p < 0.15 ? 0 : easeOutBack((p - 0.15) / 0.85);
        v.pos.addScaledVector(dir.clone().multiplyScalar(-1), 2.2 * (1 - p) * dt); // skid forward, decelerating
        v.mesh.rotation.x = anticip + -fall * (Math.PI / 2 + 0.2);
        v.mesh.position.set(v.pos.x, yBase + Math.sin(p * Math.PI) * 0.18, v.pos.z);
        if (firstFrame) this._spawnDust(v.pos, 0xcdb892);
        break;
      }
      case 'PANCAKE': {
        // squash to a wide flat disc with overshoot, then spring back up with a bounce.
        const squashP = p < 0.45 ? easeOutBack(p / 0.45) : 1 - easeOutBack((p - 0.45) / 0.55);
        const flat = Math.max(0, squashP);
        v.mesh.scale.set(base * (1 + flat * 0.9), base * (1 - flat * 0.8), base * (1 + flat * 0.9));
        v.mesh.position.set(v.pos.x, yBase + (1 - flat) * 0.05, v.pos.z);
        if (firstFrame) this._spawnDust(v.pos, 0xcdb892, 10);
        break;
      }
      case 'SPIN': {
        // accelerate into 2 full whirls (ease-in-out), wobble, then settle.
        const spin = (1 - Math.cos(p * Math.PI)) / 2;          // smooth 0→1
        v.mesh.rotation.y = v.facing + spin * Math.PI * 4;      // two full turns
        v.mesh.rotation.z = Math.sin(p * Math.PI * 6) * 0.15 * (1 - p); // dizzy lean
        v.mesh.scale.set(base * (1 + 0.1 * Math.sin(p * Math.PI)), base, base * (1 - 0.1 * Math.sin(p * Math.PI)));
        v.mesh.position.set(v.pos.x, yBase, v.pos.z);
        break;
      }
      case 'PINBALL': {
        // fast ricochet with stretch in the travel direction + dust on each wall bounce.
        const speed = 13 * (1 - p * 0.5);
        v.pos.addScaledVector(dir, speed * dt);
        const r = Math.hypot(v.pos.x, v.pos.z);
        if (r > ARENA_RADIUS - 1) {
          const n = new THREE.Vector3(v.pos.x, 0, v.pos.z).normalize();
          dir.reflect(n);
          const s = (ARENA_RADIUS - 1) / r; v.pos.x *= s; v.pos.z *= s;
          this._spawnDust(v.pos, 0xece0c8, 6);
        }
        v.mesh.rotation.x += dt * 22; v.mesh.rotation.z += dt * 16;
        const st = 1 + 0.25 * Math.sin(v._reactionT * 20);
        v.mesh.scale.set(base * st, base / Math.sqrt(st), base * st);
        v.mesh.position.set(v.pos.x, yBase + Math.abs(Math.sin(v._reactionT * 10)) * 0.5, v.pos.z);
        break;
      }
      case 'RECOIL': {
        // big launch backward + airborne tumble, land with a bounce + dust.
        v.pos.addScaledVector(dir, 9 * Math.pow(1 - p, 1.5) * dt * 3);
        this._clampToArena(v);
        v.mesh.rotation.x = p * Math.PI * 0.9;
        const air = Math.sin(Math.min(1, p / 0.7) * Math.PI) * 1.1 + bounce(p) * 0.3;
        v.mesh.position.set(v.pos.x, yBase + Math.max(0, air), v.pos.z);
        if (p > 0.72 && !v._recoilLanded) { v._recoilLanded = true; this._spawnDust(v.pos, 0xcdb892, 8); }
        break;
      }
      case 'DIZZY': {
        // woozy figure-eight sway + head bob + slight shrink/grow.
        v.mesh.rotation.z = Math.sin(v._reactionT * 14) * 0.4 * (1 - p * 0.5);
        v.mesh.rotation.y = v.facing + Math.sin(v._reactionT * 7) * 0.4;
        v.mesh.position.set(v.pos.x + Math.sin(v._reactionT * 9) * 0.12, yBase + Math.abs(Math.sin(v._reactionT * 11)) * 0.06, v.pos.z);
        break;
      }
      case 'FACEPLANT': {
        // hard slam face-first with overshoot, brief shudder, dust burst.
        const slam = easeOutBack(Math.min(1, p / 0.4));
        v.mesh.rotation.x = slam * (Math.PI / 2 + 0.15) + (p > 0.4 ? Math.sin(p * 40) * 0.05 * (1 - p) : 0);
        v.mesh.position.set(v.pos.x, yBase, v.pos.z);
        if (firstFrame) this._spawnDust(v.pos, 0xcdb892, 12);
        break;
      }
      default: {
        v.mesh.position.set(v.pos.x, yBase, v.pos.z);
      }
    }
    if (p >= 1) v._reactionCued = false; v._recoilLanded = v._recoilLanded && p < 1;
  }

  /**
   * #2 (tune) A short-lived dust puff of small particles kicked up by a
   * slapstick impact — adds readable "oomph" to the comedic reactions.
   */
  _spawnDust(pos, color = 0xcdb892, count = 7) {
    this._dust ??= [];
    const grp = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(
        new THREE.TetrahedronGeometry(0.12 + Math.random() * 0.1, 0),
        new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85, flatShading: true })
      );
      const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 2;
      m.position.set(pos.x, 0.2, pos.z);
      m.userData.vel = { x: Math.cos(a) * sp, y: 2 + Math.random() * 2, z: Math.sin(a) * sp };
      grp.add(m);
    }
    grp.userData.life = 0.6;
    this.scene.add(grp);
    this._dust.push(grp);
  }

  /** Advance + fade dust puffs; remove when expired. */
  _stepDust(dt) {
    if (!this._dust || this._dust.length === 0) return;
    const alive = [];
    for (const grp of this._dust) {
      grp.userData.life -= dt;
      const lifeFrac = Math.max(0, grp.userData.life / 0.6);
      for (const m of grp.children) {
        const vel = m.userData.vel;
        vel.y -= 9 * dt;
        m.position.x += vel.x * dt; m.position.y = Math.max(0.05, m.position.y + vel.y * dt); m.position.z += vel.z * dt;
        m.rotation.x += dt * 5; m.rotation.y += dt * 4;
        m.material.opacity = 0.85 * lifeFrac;
      }
      if (grp.userData.life > 0) alive.push(grp);
      else { grp.children.forEach((m) => { m.geometry.dispose(); m.material.dispose(); }); this.scene.remove(grp); }
    }
    this._dust = alive;
  }

  /** #5 Bob the crowd (cheering) and make the opponent trainer gesture. */
  _animateCrowdAndTrainers(dt) {
    this._t = (this._t ?? 0) + dt;
    const t = this._t;
    if (this._camera) this._billboardBars(this._camera); // #2 overhead HP bar faces camera
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

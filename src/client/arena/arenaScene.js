/**
 * Arena 3D scene + monster movement/AI (GDD §5). The combat *rules* live in
 * src/shared/combat.js; this layer visualizes combatants and moves them around
 * the coliseum sand via simple stance-driven steering (a flat-arena stand-in
 * for NavMesh navigation) with ragdoll-ish stun tilt.
 */
import * as THREE from 'three';
import { createMonster } from '../models/monster.js';
import { STANCES } from '../../shared/combat.js';

const ARENA_RADIUS = 13;
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
    this.aView = this._spawnMonster(a, new THREE.Vector3(-5, 0, 2));
    this.bView = this._spawnMonster(b, new THREE.Vector3(5, 0, 2));
    this.drops = []; // {mesh, kind}
  }

  _buildArena() {
    const sand = new THREE.Mesh(
      new THREE.CircleGeometry(ARENA_RADIUS, 56),
      new THREE.MeshStandardMaterial({ color: 0xcdb892, roughness: 1.0 })
    );
    sand.rotation.x = -Math.PI / 2; sand.receiveShadow = true;
    this.scene.add(sand);

    // Coliseum wall ring + tiered stands suggestion
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x6b5d45, roughness: 0.9, flatShading: true });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_RADIUS + 0.5, ARENA_RADIUS + 0.5, 3.5, 40, 1, true), wallMat);
    wall.position.y = 1.75; wall.material.side = THREE.BackSide;
    this.scene.add(wall);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.5, 0.6), wallMat);
      pillar.position.set(Math.cos(a) * (ARENA_RADIUS + 0.8), 2.25, Math.sin(a) * (ARENA_RADIUS + 0.8));
      this.scene.add(pillar);
    }

    // Bright arena lighting (midday coliseum)
    this.scene.add(new THREE.AmbientLight(0xfff2d8, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(8, 20, 6); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -20;
    this.scene.add(sun);
  }

  _spawnMonster(combatant, pos) {
    const mesh = createMonster(combatant.def);
    mesh.position.copy(pos);
    mesh.scale.setScalar(1.1);
    this.scene.add(mesh);
    return {
      mesh, combatant,
      pos: pos.clone(),
      facing: 0,
      _basicTimer: 0,
      _hitFlash: 0,
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
    if (locked) { this._animate(dt); return events; }
    this._stepMonster(this.aView, this.bView, dt, events, 'a');
    this._stepMonster(this.bView, this.aView, dt, events, 'b');
    this._animate(dt);
    return events;
  }

  _stepMonster(self, foe, dt, events, tag) {
    const c = self.combatant;
    // stun → tilt the mesh like a ragdoll, no movement
    if (c.isStunned) { self.mesh.rotation.z = Math.sin(performance.now() * 0.02) * 0.5; return; }
    self.mesh.rotation.z *= 0.8;

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

    if (move.lengthSq() > 0) {
      self.pos.addScaledVector(move.normalize(), speed * dt);
      const r = Math.hypot(self.pos.x, self.pos.z);
      if (r > ARENA_RADIUS - 1) { const s = (ARENA_RADIUS - 1) / r; self.pos.x *= s; self.pos.z *= s; }
    }
    self.facing = Math.atan2(toFoe.x, toFoe.z);
  }

  _animate(dt) {
    for (const v of [this.aView, this.bView]) {
      const yBase = v.combatant.def.silhouette === 'raptor_hover' ? 0.3 : 0;
      v.mesh.position.set(v.pos.x, yBase, v.pos.z);
      v.mesh.rotation.y = v.facing;
      if (v._hitFlash > 0) {
        v._hitFlash -= dt;
        v.mesh.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(v._hitFlash > 0 ? 0x661111 : 0x000000); });
      }
    }
  }

  get arenaRadius() { return ARENA_RADIUS; }
  get meleeRange() { return MELEE_RANGE; }
}

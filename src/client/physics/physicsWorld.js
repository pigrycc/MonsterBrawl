/**
 * Rapier-backed physics for the arena (feedback #1: true physics / ragdoll,
 * replacing the per-frame position clamp).
 *
 * Scope — rigid-body physics + tumble ragdoll (NOT articulated skeletons):
 *   - Each monster is a dynamic capsule rigid body.
 *   - The coliseum wall is a ring of fixed colliders → monsters physically
 *     cannot pass through it (solid out-of-bounds, #6 done properly).
 *   - Movement while active: we drive the body's horizontal velocity toward the
 *     steering target and keep it upright (locked angular factor).
 *   - Knockback / shove / recoil / pinball: real impulses on the body.
 *   - Stun: unlock rotation + apply a tumbling impulse → the body ragdolls
 *     freely for the stun duration, then re-locks upright on recovery.
 *
 * Rapier (`@dimforge/rapier3d-compat`) needs async WASM init; call and await
 * PhysicsWorld.create().
 */
import RAPIER from '@dimforge/rapier3d-compat';

let _ready = null;
let _isReady = false;
/** Initialize the Rapier WASM runtime once. */
export function initRapier() {
  if (!_ready) _ready = RAPIER.init().then(() => { _isReady = true; });
  return _ready;
}
/** Whether Rapier WASM has finished loading (physics can be used). */
export function isRapierReady() { return _isReady; }

export class PhysicsWorld {
  /** @param {{radius:number}} opts arena radius for the wall ring */
  static async create(opts) {
    await initRapier();
    return new PhysicsWorld(opts);
  }

  constructor({ radius }) {
    this.radius = radius;
    this.world = new RAPIER.World({ x: 0, y: -9.81 * 2, z: 0 }); // punchy gravity
    this.bodies = new Map(); // key → { body, collider, upright }
    this._buildArena(radius);
  }

  _buildArena(radius) {
    // Sand floor: a large fixed cuboid just under y=0.
    const floor = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(radius + 4, 0.5, radius + 4).setFriction(0.8), floor);

    // Coliseum wall: a ring of fixed box colliders so bodies can't escape.
    const segs = 48;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.cos(a) * (radius + 0.5);
      const z = Math.sin(a) * (radius + 0.5);
      const seg = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, 2, z).setRotation(quatY(-a)));
      // thin tall slab tangent to the ring
      const w = (Math.PI * 2 * (radius + 0.5)) / segs / 2 + 0.2;
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(w, 3, 0.4).setRestitution(0.4), seg);
    }
  }

  /**
   * Add a monster body. Capsule, upright-locked while active.
   * @param {string} key
   * @param {{x:number,z:number}} pos
   * @param {number} [mass]
   */
  addMonster(key, pos, mass = 1) {
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(pos.x, 1.0, pos.z)
        .setLinearDamping(0.6)
        .setAngularDamping(0.8)
        .lockRotations() // upright while active
        .enabledRotations(false, true, false)
    );
    const collider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.5, 0.5).setFriction(0.5).setRestitution(0.3).setDensity(mass),
      body
    );
    const entry = { body, collider, upright: true };
    this.bodies.set(key, entry);
    return entry;
  }

  /** Drive a monster toward a desired horizontal velocity (active steering). */
  setDesiredVelocity(key, vx, vz) {
    const e = this.bodies.get(key); if (!e || !e.upright) return;
    const v = e.body.linvel();
    e.body.setLinvel({ x: vx, y: v.y, z: vz }, true);
  }

  /** Apply an instantaneous impulse (shove / recoil / pinball). */
  applyImpulse(key, ix, iy, iz) {
    const e = this.bodies.get(key); if (!e) return;
    e.body.applyImpulse({ x: ix, y: iy, z: iz }, true);
  }

  /** Enter ragdoll: unlock rotation + tumble. */
  ragdoll(key, dir = { x: 1, z: 0 }) {
    const e = this.bodies.get(key); if (!e) return;
    e.upright = false;
    e.body.setEnabledRotations(true, true, true, true);
    e.body.applyImpulse({ x: dir.x * 3, y: 5, z: dir.z * 3 }, true);
    e.body.applyTorqueImpulse({ x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: Math.random() * 4 - 2 }, true);
  }

  /** Recover from ragdoll: re-lock upright, snap rotation back. */
  standUp(key) {
    const e = this.bodies.get(key); if (!e) return;
    e.upright = true;
    e.body.setRotation(quatY(0), true);
    e.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    e.body.setEnabledRotations(false, true, false, true);
  }

  /** Current transform for rendering. */
  getTransform(key) {
    const e = this.bodies.get(key); if (!e) return null;
    const t = e.body.translation();
    const r = e.body.rotation();
    return { pos: t, rot: r };
  }

  /** Teleport a body (used by debug / fail-safe). */
  setPosition(key, x, y, z) {
    const e = this.bodies.get(key); if (!e) return;
    e.body.setTranslation({ x, y, z }, true);
    e.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  }

  step(dt) {
    // Rapier uses a fixed internal timestep; set it to match our frame.
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
  }

  dispose() { this.world.free?.(); this.bodies.clear(); }
}

/** Quaternion for a rotation about the Y axis. */
function quatY(a) {
  return { x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) };
}

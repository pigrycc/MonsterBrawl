/**
 * First-person controller: pointer-lock mouse-look + WASD ground movement with
 * simple AABB-free collision against a configurable circular boundary. Used by
 * the lobby (walk around the ready room) and later the FPP arena (GDD §5).
 */
import * as THREE from 'three';

export class FppController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('./input.js').Input} input
   * @param {HTMLElement} domElement  element to request pointer lock on
   * @param {Object} [opts]
   */
  constructor(camera, input, domElement, opts = {}) {
    this.camera = camera;
    this.input = input;
    this.dom = domElement;
    this.speed = opts.speed ?? 4.0;        // m/s
    this.eyeHeight = opts.eyeHeight ?? 1.6;
    this.sensitivity = opts.sensitivity ?? 0.0022;
    this.boundaryRadius = opts.boundaryRadius ?? 14;
    this.enabled = true;
    this.locked = false;

    this.yaw = 0;
    this.pitch = 0;
    this.position = new THREE.Vector3(opts.x ?? 0, this.eyeHeight, opts.z ?? 6);

    this._onClick = () => { if (this.enabled) this.dom.requestPointerLock?.(); };
    this._onLockChange = () => { this.locked = document.pointerLockElement === this.dom; };
    this.dom.addEventListener('click', this._onClick);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  setEnabled(v) { this.enabled = v; if (!v && this.locked) document.exitPointerLock?.(); }

  /** @param {number} dt seconds */
  update(dt) {
    if (!this.enabled) return;

    if (this.locked) {
      const { dx, dy } = this.input.consumeMouseDelta();
      this.yaw -= dx * this.sensitivity;
      this.pitch -= dy * this.sensitivity;
      const lim = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    }

    // Movement relative to yaw (flat, no flying)
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const move = new THREE.Vector3();
    if (this.input.isDown('KeyW') || this.input.isDown('ArrowUp')) move.add(forward);
    if (this.input.isDown('KeyS') || this.input.isDown('ArrowDown')) move.sub(forward);
    if (this.input.isDown('KeyD') || this.input.isDown('ArrowRight')) move.add(right);
    if (this.input.isDown('KeyA') || this.input.isDown('ArrowLeft')) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(this.speed * dt);
      this.position.add(move);
      // circular boundary
      const r = Math.hypot(this.position.x, this.position.z);
      if (r > this.boundaryRadius) {
        const s = this.boundaryRadius / r;
        this.position.x *= s; this.position.z *= s;
      }
    }

    this.position.y = this.eyeHeight;
    this.camera.position.copy(this.position);
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);
  }

  /** Forward direction on the XZ plane (for interaction raycasts / facing). */
  getForward() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).normalize();
  }

  dispose() {
    this.dom.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }
}

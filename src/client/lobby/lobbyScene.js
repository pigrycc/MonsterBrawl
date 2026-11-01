/**
 * 3D Gladiatorial Ready Room — the lobby/pre-game hub (GDD §3).
 *
 * Contains:
 *   - A walled ready-room environment the trainer walks around in (FPP).
 *   - A physical mirror: approach + [E] cycles skin tone; [R] cycles tunic.
 *   - 5 stone pedestals showcasing the monster archetypes; approach + [E] binds.
 *   - The local trainer model (also reflected-ish in front of the mirror).
 *   - Nearest-interactable detection that drives the [E] prompt.
 *
 * Exposes update(dt) for the render loop and getInteractables() for the shell.
 */
import * as THREE from 'three';
import { createTrainer, setTrainerSkin, setTrainerTunic, SKIN_TONES, TUNIC_COLORS } from '../models/trainer.js';
import { createMonster } from '../models/monster.js';
import { LocalState, PEDESTAL_MONSTERS } from '../state/localState.js';

const ROOM_RADIUS = 15;
const PEDESTAL_RING = 9;
const INTERACT_DIST = 2.6;

export class LobbyScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0c12);
    this.scene.fog = new THREE.Fog(0x0a0c12, 14, 36);

    this._buildEnvironment();
    this._buildMirror();
    this._buildPedestals();
    this._buildLocalTrainer();

    this._skinIdx = 0;
    this._tunicIdx = 0;
    this.nearest = null; // {type:'pedestal'|'mirror', ...}
  }

  _buildEnvironment() {
    // Sand/stone floor
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(ROOM_RADIUS + 1, 48),
      new THREE.MeshStandardMaterial({ color: 0x2a2c34, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Circular wall ring (low-poly columns)
    const colGeo = new THREE.CylinderGeometry(0.5, 0.6, 6, 6);
    const colMat = new THREE.MeshStandardMaterial({ color: 0x3a3d47, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const col = new THREE.Mesh(colGeo, colMat);
      col.position.set(Math.cos(a) * ROOM_RADIUS, 3, Math.sin(a) * ROOM_RADIUS);
      col.castShadow = true;
      this.scene.add(col);
    }

    // Lighting — warm torch ambience (brightened for readability)
    this.scene.add(new THREE.AmbientLight(0x6b76a0, 1.15));
    const key = new THREE.DirectionalLight(0xfff1d0, 1.5);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
    fill.position.set(-6, 8, -4);
    this.scene.add(fill);
    // Warm center brazier glow
    const rim = new THREE.PointLight(0xff8c42, 1.0, 40);
    rim.position.set(0, 5, 0);
    this.scene.add(rim);
    // Torch glow near each pedestal added in _buildPedestals()
  }

  _buildMirror() {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 3.4, 0.3),
      new THREE.MeshStandardMaterial({ color: 0x8a6d3b, roughness: 0.6, metalness: 0.3, flatShading: true })
    );
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 2.9),
      new THREE.MeshStandardMaterial({ color: 0x9fd0e0, roughness: 0.1, metalness: 0.9 })
    );
    glass.position.z = 0.16;
    g.add(frame, glass);
    g.position.set(0, 1.9, -(PEDESTAL_RING + 2.5));
    this.mirror = g;
    this.scene.add(g);

    // Label sprite anchor (position used by prompt detection)
    this.mirrorAnchor = new THREE.Vector3(0, 0, -(PEDESTAL_RING + 1.2));
  }

  _buildPedestals() {
    this.pedestals = [];
    const n = PEDESTAL_MONSTERS.length;
    PEDESTAL_MONSTERS.forEach((m, i) => {
      // Arrange across a front arc so they're visible on spawn.
      const spread = Math.PI * 1.1;
      const a = -Math.PI / 2 - spread / 2 + (i / (n - 1)) * spread;
      const x = Math.cos(a) * PEDESTAL_RING;
      const z = Math.sin(a) * PEDESTAL_RING;

      const group = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(1.0, 1.2, 1.0, 6),
        new THREE.MeshStandardMaterial({ color: 0x4a4e5a, roughness: 0.85, flatShading: true })
      );
      base.position.y = 0.5;
      base.castShadow = true; base.receiveShadow = true;
      group.add(base);

      const monster = createMonster(m);
      monster.position.y = 1.0;
      monster.scale.setScalar(0.9);
      group.add(monster);

      // Showcase spotlight tinted to the monster's color
      const spot = new THREE.PointLight(m.color, 0.9, 7);
      spot.position.set(0, 2.6, 0.4);
      group.add(spot);

      group.position.set(x, 0, z);
      group.userData = { type: 'pedestal', monster: m, anchor: new THREE.Vector3(x, 0, z), monsterMesh: monster };
      this.pedestals.push(group);
      this.scene.add(group);
    });
  }

  _buildLocalTrainer() {
    const app = LocalState.get().appearance;
    this.trainer = createTrainer({ skinTone: app.skinTone, tunicColor: app.tunicColor, name: app.name });
    // Stands in front of the mirror by default
    this.trainer.position.set(2.5, 0, 0);
    this.scene.add(this.trainer);
    this._skinIdx = Math.max(0, SKIN_TONES.indexOf(app.skinTone));
    this._tunicIdx = Math.max(0, TUNIC_COLORS.indexOf(app.tunicColor));
  }

  // --- interaction --------------------------------------------------------
  /**
   * Find the nearest interactable to a world position (the player's feet).
   * @param {THREE.Vector3} playerPos
   */
  updateNearest(playerPos) {
    let best = null;
    let bestD = INTERACT_DIST;

    // mirror
    const dMirror = Math.hypot(playerPos.x - this.mirrorAnchor.x, playerPos.z - this.mirrorAnchor.z);
    if (dMirror < bestD) { bestD = dMirror; best = { type: 'mirror' }; }

    // pedestals
    for (const p of this.pedestals) {
      const a = p.userData.anchor;
      const d = Math.hypot(playerPos.x - a.x, playerPos.z - a.z);
      if (d < bestD) { bestD = d; best = { type: 'pedestal', monster: p.userData.monster, group: p }; }
    }

    this.nearest = best;
    return best;
  }

  /** Cycle skin tone (mirror [E]). */
  cycleSkin() {
    this._skinIdx = (this._skinIdx + 1) % SKIN_TONES.length;
    const hex = SKIN_TONES[this._skinIdx];
    setTrainerSkin(this.trainer, hex);
    LocalState.setAppearance({ skinTone: hex });
    return hex;
  }

  /** Cycle tunic color (mirror [R]). */
  cycleTunic() {
    this._tunicIdx = (this._tunicIdx + 1) % TUNIC_COLORS.length;
    const hex = TUNIC_COLORS[this._tunicIdx];
    setTrainerTunic(this.trainer, hex);
    LocalState.setAppearance({ tunicColor: hex });
    return hex;
  }

  /** Bind the monster on the nearest pedestal. */
  bindMonster(monster) {
    LocalState.selectMonster(monster.id);
    // Highlight the chosen pedestal; dim others.
    for (const p of this.pedestals) {
      const chosen = p.userData.monster.id === monster.id;
      p.userData.monsterMesh.traverse((o) => {
        if (o.isMesh) o.material.emissive?.setHex(chosen ? 0x332200 : 0x000000);
      });
    }
    return monster;
  }

  update(dt, t) {
    // Idle bob on pedestal monsters
    this.pedestals.forEach((p, i) => {
      p.userData.monsterMesh.rotation.y += dt * 0.6;
      p.userData.monsterMesh.position.y = 1.0 + Math.sin(t * 1.4 + i) * 0.06;
    });
  }

  get boundaryRadius() { return ROOM_RADIUS - 1; }
}

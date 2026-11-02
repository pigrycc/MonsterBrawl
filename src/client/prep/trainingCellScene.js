/**
 * Training Cell 3D scene (GDD §4A): the fighter stands before their chosen
 * monster with 6 stone skill totems arranged in a front arc. The player aims
 * the crosshair (center-screen ray) at a totem to reveal its world tooltip and
 * holds [E] to purchase.
 */
import * as THREE from 'three';
import { createMonster } from '../models/monster.js';
import { createTotem } from '../models/totem.js';

export class TrainingCellScene {
  /** @param {import('../../shared/prepSession.js').TrainingCell} cell */
  constructor(cell) {
    this.cell = cell;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c0e16);
    this.scene.fog = new THREE.Fog(0x0c0e16, 10, 30);
    this.raycaster = new THREE.Raycaster();

    this._buildRoom();
    this._buildMonster();
    this._buildTotems();
  }

  _buildRoom() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(12, 40),
      new THREE.MeshStandardMaterial({ color: 0x23262f, roughness: 0.95 })
    );
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    this.scene.add(floor);

    this.scene.add(new THREE.AmbientLight(0x6b76a0, 1.1));
    const key = new THREE.DirectionalLight(0xfff1d0, 1.3);
    key.position.set(4, 12, 6); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const back = new THREE.PointLight(0x88aaff, 0.6, 24);
    back.position.set(0, 4, -8);
    this.scene.add(back);
  }

  _buildMonster() {
    const m = createMonster(this.cell.monster);
    m.position.set(0, 0, -6);
    m.scale.setScalar(1.2);
    this.scene.add(m);
    this.monsterMesh = m;
  }

  _buildTotems() {
    this.totems = [];
    const n = this.cell.totems.length; // 6
    const radius = 5;
    this.cell.totems.forEach((entry, i) => {
      const spread = Math.PI * 1.15;
      const a = -Math.PI / 2 - spread / 2 + (i / (n - 1)) * spread;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius + 1.5; // shift arc toward the player
      const totem = createTotem(entry.skill);
      totem.position.set(x, 0, z);
      totem.userData.index = i;
      totem.userData.anchor = new THREE.Vector3(x, 2.2, z);
      this.totems.push(totem);
      this.scene.add(totem);
    });
  }

  /**
   * Raycast from screen center through the camera; return the first totem hit
   * (and its index), or null.
   */
  totemUnderCrosshair(camera) {
    this.raycaster.setFromCamera({ x: 0, y: 0 }, camera);
    const meshes = [];
    for (const t of this.totems) t.traverse((o) => { if (o.isMesh) { o.userData._totem = t; meshes.push(o); } });
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      const t = h.object.userData._totem;
      if (t && h.distance < 8) return { totem: t, index: t.userData.index };
    }
    return null;
  }

  update(dt, t) {
    this.monsterMesh.rotation.y = Math.sin(t * 0.3) * 0.2;
    for (const totem of this.totems) {
      totem.userData.rune.rotation.y += dt * 1.5;
      totem.userData.rune.position.y = 2.2 + Math.sin(t * 2 + totem.userData.index) * 0.08;
    }
  }
}

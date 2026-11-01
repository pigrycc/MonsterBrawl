/**
 * Procedural low-poly human trainer (GDD §3). No external assets — built from
 * primitives so it ships inside the bundle and renders anywhere.
 *
 * Customization points (driven by the mirror, GDD §3):
 *   - skinTone:  head + hands material color
 *   - tunicColor: torso material color
 *
 * Returns a THREE.Group with `userData.parts` references so the mirror can
 * recolor materials live, and helpers to update appearance.
 */
import * as THREE from 'three';

export const SKIN_TONES = [
  0xf1c9a5, 0xe0ac86, 0xc68642, 0x8d5524, 0x5c3a21, 0xffdbac, 0xa66a4a,
];

export const TUNIC_COLORS = [
  0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0x16a085, 0xecf0f1, 0x2c3e50,
];

/**
 * @param {Object} [opts]
 * @param {number} [opts.skinTone]
 * @param {number} [opts.tunicColor]
 * @param {string} [opts.name]
 * @returns {THREE.Group}
 */
export function createTrainer({ skinTone = SKIN_TONES[0], tunicColor = TUNIC_COLORS[0], name = 'Trainer' } = {}) {
  const group = new THREE.Group();
  group.name = `trainer:${name}`;

  const skinMat = new THREE.MeshStandardMaterial({ color: skinTone, flatShading: true, roughness: 0.8 });
  const tunicMat = new THREE.MeshStandardMaterial({ color: tunicColor, flatShading: true, roughness: 0.7 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4b, flatShading: true, roughness: 0.9 });

  // Torso (tapered box via cylinder with few sides)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.7, 6), tunicMat);
  torso.position.y = 1.05;
  group.add(torso);

  // Head
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), skinMat);
  head.position.y = 1.58;
  group.add(head);

  // Simple hair/cap cue
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 6), tunicMat);
  cap.position.y = 1.72;
  group.add(cap);

  // Arms
  const armGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.6, 5);
  const armL = new THREE.Mesh(armGeo, skinMat);
  armL.position.set(-0.34, 1.05, 0);
  armL.rotation.z = 0.25;
  group.add(armL);
  const armR = new THREE.Mesh(armGeo, skinMat);
  armR.position.set(0.34, 1.05, 0);
  armR.rotation.z = -0.25;
  group.add(armR);

  // Legs
  const legGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.7, 5);
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.13, 0.35, 0);
  group.add(legL);
  const legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0.13, 0.35, 0);
  group.add(legR);

  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  group.userData.parts = { skinMat, tunicMat, head, torso, cap, armL, armR };
  group.userData.appearance = { skinTone, tunicColor, name };

  return group;
}

/** Recolor a trainer's skin live (used by the mirror). */
export function setTrainerSkin(group, hex) {
  group.userData.parts.skinMat.color.setHex(hex);
  group.userData.appearance.skinTone = hex;
}

/** Recolor a trainer's tunic live (used by the mirror). */
export function setTrainerTunic(group, hex) {
  group.userData.parts.tunicMat.color.setHex(hex);
  group.userData.appearance.tunicColor = hex;
}

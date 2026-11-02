/**
 * Procedural stone skill totem (GDD §4A): a carved stone pillar on a pedestal
 * with a floating elemental rune. Color-tinted by the skill's element.
 */
import * as THREE from 'three';

const ELEMENT_HEX = {
  Neutral: 0xb9c2d0, Fire: 0xff6b3d, Water: 0x3fa7ff, Earth: 0xb98a4a,
  Electric: 0xffd633, Flying: 0x9fd0ff, Grass: 0x5fd36a,
};

/** @param {import('../../shared/skills.js').Skill} skill */
export function createTotem(skill) {
  const g = new THREE.Group();
  const tint = ELEMENT_HEX[skill.element] ?? 0xb9c2d0;

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.65, 0.5, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a4e5a, roughness: 0.9, flatShading: true })
  );
  pedestal.position.y = 0.25;
  g.add(pedestal);

  const pillar = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 1.1, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x6b7180, roughness: 0.85, flatShading: true })
  );
  pillar.position.y = 1.05;
  g.add(pillar);

  // Floating elemental rune (glows in the skill's element color)
  const rune = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.2, 0),
    new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 0.6, flatShading: true })
  );
  rune.position.y = 1.9;
  g.add(rune);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData = { type: 'totem', skill, rune, pillar, baseTint: tint, purchased: false };
  return g;
}

/** Mark a totem purchased: dim the rune, darken the pillar. */
export function markTotemPurchased(totem) {
  totem.userData.purchased = true;
  totem.userData.rune.material.emissiveIntensity = 0.05;
  totem.userData.rune.material.color.setHex(0x333740);
  totem.userData.pillar.material.color.setHex(0x3a3d47);
}

/**
 * Procedural low-poly monster models (GDD §7). Each of the 5 archetypes has a
 * distinct silhouette built from primitives. Driven by the monster definition
 * (color/accent/silhouette) from src/shared/monsters.js.
 *
 * Returns a THREE.Group centered at origin, roughly ~1.2–1.8 units tall, with
 * `userData.monster` set so pedestal/selection code can read it back.
 */
import * as THREE from 'three';

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, ...opts });
}

/** @param {import('../../shared/monsters.js').Monster} m */
export function createMonster(m) {
  const g = new THREE.Group();
  g.name = `monster:${m.id}`;
  const body = mat(m.color);
  const accent = mat(m.accent);

  switch (m.silhouette) {
    case 'biped_stocky': { // Pyroroc — stocky lava-reptile w/ obsidian shell
      const torso = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6, 0), body);
      torso.position.y = 0.9; torso.scale.set(1, 1.1, 0.9); g.add(torso);
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), accent);
      shell.position.set(0, 1.0, -0.35); g.add(shell);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.33, 0.5, 6), body);
      head.position.set(0, 1.5, 0.15); head.rotation.x = 0.4; g.add(head);
      for (const s of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.5, 6), body);
        leg.position.set(0.28 * s, 0.3, 0); g.add(leg);
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 5), body);
        arm.position.set(0.5 * s, 0.95, 0.1); arm.rotation.z = -0.4 * s; g.add(arm);
      }
      break;
    }
    case 'slug_stalked': { // Aquaslug — jelly mollusk w/ dual eye-stalks
      const bodyMesh = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), mat(m.color, { transparent: true, opacity: 0.85 }));
      bodyMesh.position.y = 0.55; bodyMesh.scale.set(1.3, 0.8, 1); g.add(bodyMesh);
      for (const s of [-1, 1]) {
        const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.5, 5), body);
        stalk.position.set(0.18 * s, 1.0, 0.2); g.add(stalk);
        const eye = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), accent);
        eye.position.set(0.18 * s, 1.28, 0.2); g.add(eye);
      }
      break;
    }
    case 'fox_angular': { // Voltkid — geometric spark-fox, big ears
      const torso = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), body);
      torso.position.y = 0.75; torso.scale.set(1.2, 0.9, 1); g.add(torso);
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.45, 4), body);
      head.position.set(0, 1.15, 0.35); head.rotation.x = 1.2; g.add(head);
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 4), accent);
        ear.position.set(0.16 * s, 1.5, 0.3); ear.rotation.z = 0.2 * s; g.add(ear);
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 4), body);
        leg.position.set(0.22 * s, 0.25, 0.15); g.add(leg);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 5), accent);
      tail.position.set(0, 0.85, -0.5); tail.rotation.x = -0.9; g.add(tail);
      break;
    }
    case 'quad_armored': { // Terrataur — low quadruped armadillo, slate armor
      const shell = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), accent);
      shell.position.y = 0.55; shell.scale.set(1.4, 1, 1.1); g.add(shell);
      const belly = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 1.1), body);
      belly.position.y = 0.3; g.add(belly);
      const head = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), body);
      head.position.set(0, 0.45, 0.85); g.add(head);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.35, 5), body);
        leg.position.set(0.5 * sx, 0.17, 0.4 * sz); g.add(leg);
      }
      break;
    }
    case 'raptor_hover': { // Galebird — geometric raptor hovering above sand
      const torso = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 5), body);
      torso.position.y = 1.0; torso.rotation.x = Math.PI / 2; g.add(torso);
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), body);
      head.position.set(0, 1.1, 0.5); g.add(head);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.3, 4), accent);
      beak.position.set(0, 1.1, 0.75); beak.rotation.x = Math.PI / 2; g.add(beak);
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.05, 0.4), accent);
        wing.position.set(0.5 * s, 1.0, 0); wing.rotation.z = 0.2 * s; g.add(wing);
      }
      g.position.y = 0.3; // hovers slightly above the sand
      break;
    }
    default: {
      const fallback = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 0), body);
      fallback.position.y = 0.9; g.add(fallback);
    }
  }

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.userData.monster = m;
  return g;
}

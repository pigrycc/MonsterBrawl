/**
 * Renderer bootstrap. For this slice it stands up a real Three.js scene (so the
 * packaged desktop build proves WebGL works end-to-end) and a boot panel that
 * confirms the shared data layer loaded inside the app. Later slices replace the
 * placeholder scene with the actual 3D lobby (GDD §3).
 */
import * as THREE from 'three';
import { SKILLS, SKILL_COUNT } from '../shared/skills.js';
import { MONSTERS } from '../shared/monsters.js';
import { DebugConfig } from '../shared/debugConfig.js';

const app = document.getElementById('app');

// --- Three.js scene ---------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 12, 40);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 3.2, 8);
camera.lookAt(0, 1, 0);

scene.add(new THREE.AmbientLight(0x6677aa, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.1);
key.position.set(5, 10, 6);
scene.add(key);

// Ground
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(20, 48),
  new THREE.MeshStandardMaterial({ color: 0x1a2030, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// One low-poly pedestal + colored block per monster (preview of the lobby's
// 5 selection pedestals, GDD §3). Replaced with real models in the lobby slice.
const monsterMeshes = [];
MONSTERS.forEach((m, i) => {
  const angle = (i / MONSTERS.length) * Math.PI * 2;
  const r = 4.5;
  const x = Math.cos(angle) * r;
  const z = Math.sin(angle) * r;

  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.1, 0.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x2b3448, roughness: 0.8 })
  );
  pedestal.position.set(x, 0.3, z);
  scene.add(pedestal);

  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.7, 0),
    new THREE.MeshStandardMaterial({ color: m.color, flatShading: true })
  );
  body.position.set(x, 1.3, z);
  body.userData.monster = m;
  scene.add(body);
  monsterMeshes.push(body);
});

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

let t = 0;
function tick() {
  t += 0.016;
  monsterMeshes.forEach((mesh, i) => {
    mesh.rotation.y += 0.01;
    mesh.position.y = 1.3 + Math.sin(t * 1.5 + i) * 0.12;
  });
  scene.rotation.y = Math.sin(t * 0.1) * 0.15;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// --- Boot panel: proves the data layer loaded inside the app ----------------
const env = globalThis.mcb?.env;
const panel = document.createElement('div');
panel.style.cssText = `
  position: fixed; top: 16px; left: 16px; max-width: 360px; padding: 16px 18px;
  background: rgba(14,18,28,0.82); border: 1px solid #2b3448; border-radius: 10px;
  backdrop-filter: blur(6px); line-height: 1.5; font-size: 13px;`;
panel.innerHTML = `
  <div style="font-size:16px;font-weight:700;margin-bottom:6px;">⚔️ Monster Coliseum Brawl</div>
  <div style="color:#8aa0c8;margin-bottom:10px;">Lobby reached — prototype shell</div>
  <div><b>${SKILL_COUNT}</b> skills loaded · <b>${MONSTERS.length}</b> monsters</div>
  <div style="margin-top:4px;color:#8aa0c8;">Roster: ${MONSTERS.map((m) => m.name).join(', ')}</div>
  <div style="margin-top:4px;color:#8aa0c8;">Start gold: ${DebugConfig.get('startingGoldAmount')} ·
    Prep: ${DebugConfig.get('trainingPhaseDuration')}s</div>
  <div style="margin-top:10px;font-size:11px;color:#5e6f8f;">
    ${env ? `Electron ${env.electron} · ${env.platform}/${env.arch}` : 'Running in browser (dev)'}
  </div>`;
document.body.appendChild(panel);

// Sanity log for CI smoke checks.
console.log(`[MCB] boot ok — ${SKILLS.length} skills, ${MONSTERS.length} monsters`);

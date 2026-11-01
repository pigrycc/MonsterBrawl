/**
 * Renderer entry point / app shell. Boots the 3D lobby (GDD §3), wires input,
 * interaction prompts, and the host match-setup console. This is the hub the
 * prep-phase and arena slices will transition out of.
 */
import * as THREE from 'three';
import { Input } from './engine/input.js';
import { FppController } from './engine/fppController.js';
import { Overlay } from './ui/overlay.js';
import { HostConsole } from './ui/hostConsole.js';
import { LobbyScene } from './lobby/lobbyScene.js';
import { LocalState } from './state/localState.js';
import { getMonster } from '../shared/monsters.js';

const app = document.getElementById('app');

// --- renderer ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);

// --- lobby ------------------------------------------------------------------
const lobby = new LobbyScene();
const input = new Input(window);
const controller = new FppController(camera, input, renderer.domElement, {
  x: 0, z: 6, boundaryRadius: lobby.boundaryRadius, eyeHeight: 1.6, speed: 4.2,
});
// Spawn facing the pedestal arc + mirror (toward -Z): yaw 0 → forward (0,0,-1).
controller.yaw = 0;
const overlay = new Overlay();
const hostConsole = new HostConsole(onStartMatch);

// --- interaction bindings ---------------------------------------------------
// [E]: context-sensitive — bind monster at a pedestal, or cycle skin at mirror.
input.onPress('KeyE', () => {
  const n = lobby.nearest;
  if (!n) return;
  if (n.type === 'pedestal') {
    lobby.bindMonster(n.monster);
    overlay.showToast(`Bound ${n.monster.name} (${n.monster.role})`);
  } else if (n.type === 'mirror') {
    lobby.cycleSkin();
    overlay.showToast('Skin tone changed');
  }
});

// [R]: cycle tunic color while at the mirror.
input.onPress('KeyR', () => {
  if (lobby.nearest?.type === 'mirror') {
    lobby.cycleTunic();
    overlay.showToast('Tunic color changed');
  }
});

// [Tab]: toggle the host console.
input.onPress('Tab', (e) => { e.preventDefault(); hostConsole.toggle(); });

function onStartMatch() {
  const st = LocalState.get();
  const m = getMonster(st.selectedMonsterId);
  overlay.showToast(`Starting ${st.gameMode} as ${m?.name}… (prep phase next slice)`);
  // TODO(prep-slice): transition into the Dual Preparation Phase (GDD §4).
  console.log('[MCB] START MATCH', { mode: st.gameMode, monster: st.selectedMonsterId, roomName: st.roomName, players: st.playerLimit, botFill: st.botFill });
}

// --- resize -----------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- loop -------------------------------------------------------------------
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  controller.update(dt);
  lobby.update(dt, t);

  // nearest-interactable → prompt
  const n = lobby.updateNearest(controller.position);
  if (n?.type === 'pedestal') {
    const sel = LocalState.get().selectedMonsterId === n.monster.id;
    overlay.showPrompt(`Press <b>[E]</b> to ${sel ? 're-bind' : 'choose'} <b>${n.monster.name}</b> — ${n.monster.role}`);
  } else if (n?.type === 'mirror') {
    overlay.showPrompt(`<b>[E]</b> cycle skin · <b>[R]</b> cycle tunic`);
  } else {
    overlay.hidePrompt();
  }

  renderer.render(lobby.scene, camera);
  requestAnimationFrame(tick);
}
tick();

console.log('[MCB] lobby ready');

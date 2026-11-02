/**
 * Top-level application state machine. Owns the shared renderer + input and
 * transitions between phases: LOBBY (§3) → PREP (§4) → ARENA (§5, upcoming).
 *
 * Each phase owns its own THREE.Scene/camera and an update() method; the app
 * drives a single render loop and swaps the active phase on transitions.
 */
import * as THREE from 'three';
import { Input } from './engine/input.js';
import { FppController } from './engine/fppController.js';
import { Overlay } from './ui/overlay.js';
import { HostConsole } from './ui/hostConsole.js';
import { LobbyScene } from './lobby/lobbyScene.js';
import { LocalState } from './state/localState.js';
import { PrepPhase } from './prep/prepPhase.js';
import { ArenaPhase } from './arena/arenaPhase.js';
import { DebugConsole } from './ui/debugConsole.js';
import { DebugConfig } from '../shared/debugConfig.js';
import { freeSkills } from '../shared/skills.js';

export class GameApp {
  constructor(mountEl) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountEl.appendChild(this.renderer.domElement);

    this.input = new Input(window);
    this.phase = null;         // { update(), dispose() }
    this.phaseName = null;

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      if (this.phase?.camera) {
        this.phase.camera.aspect = window.innerWidth / window.innerHeight;
        this.phase.camera.updateProjectionMatrix();
      }
    });

    // Global in-game debug console (GDD §9), toggled with [~] (Backquote).
    // Lives above all phases so you can tune variables anywhere.
    this.debugConsole = new DebugConsole();
    this.input.onPress('Backquote', (e) => {
      // Don't hijack the key while typing into a form field.
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      this.debugConsole.toggle();
    });

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    this.enterLobby();

    // Debug/testability hook (also handy for manual QA). Lets you jump phases
    // without physically walking to a pedestal.
    window.mcbDebug = {
      selectMonster: (id) => LocalState.selectMonster(id),
      startMatch: () => this.startMatch(),
      phase: () => this.phaseName,
      state: () => LocalState.get(),
      toggleConsole: () => this.debugConsole.toggle(),
    };
  }

  _swap(next, name) {
    this.phase?.dispose?.();
    this.phase = next;
    this.phaseName = name;
    console.log(`[MCB] phase → ${name}`);
  }

  // --- LOBBY ----------------------------------------------------------------
  enterLobby() {
    this._swap(new LobbyPhase(this.renderer, this.input, () => this.startMatch()), 'LOBBY');
  }

  startMatch() {
    const st = LocalState.get();
    // Debug override: forceLocalMonsterType (GDD §9) wins over the pedestal pick.
    const forced = DebugConfig.get('forceLocalMonsterType');
    const localMonster = (forced && forced !== 'NONE') ? forced.toLowerCase() : st.selectedMonsterId;
    if (!localMonster) return;
    // Build the fighter list. Local prototype: human + one bot opponent so the
    // Tournament bout has two combatants (full bot drafting arrives in §8).
    const opponentMonster = pickOpponentMonster(localMonster);
    const fighters = [
      { playerId: st.localPlayerId, monsterId: localMonster, seed: (Date.now() & 0xffff) },
      { playerId: 'bot-1', monsterId: opponentMonster, seed: ((Date.now() >> 3) & 0xffff) },
    ];
    this.enterPrep(fighters);
  }

  // --- PREP -----------------------------------------------------------------
  enterPrep(fighters) {
    this._fighters = fighters; // remember monster ids for the arena transition
    const prep = new PrepPhase({
      renderer: this.renderer,
      input: this.input,
      localPlayerId: LocalState.get().localPlayerId,
      fighters,
      onComplete: (result) => this.onPrepComplete(result),
    });
    this._swap(prep, 'PREP');
    // Debug hook: buy the i-th totem (for manual QA / testing the purchase path
    // without needing pointer-lock aiming).
    window.mcbDebug.buyTotem = (i) => prep.debugBuy(i);
    window.mcbDebug.cell = () => prep.cell;
    window.mcbDebug.forceReady = () => prep.debugForceReady();
  }

  onPrepComplete(result) {
    console.log('[MCB] prep complete — loadouts:', result.loadoutByPlayer);
    // Combine remembered monster ids with each fighter's drafted loadout, then
    // enter the arena. A fighter who drafted nothing (e.g. a passive bot) gets
    // a fallback of 4 free basic skills so the bout is always valid.
    const fallback = freeSkills().slice(0, 4).map((s) => s.id);
    const arenaFighters = this._fighters.map((f) => ({
      playerId: f.playerId,
      monsterId: f.monsterId,
      skillIds: (result.loadoutByPlayer?.[f.playerId]?.length ? result.loadoutByPlayer[f.playerId] : fallback),
      isBot: f.playerId !== LocalState.get().localPlayerId,
    }));
    this.enterArena(arenaFighters);
  }

  // --- ARENA ----------------------------------------------------------------
  enterArena(fighters) {
    const arena = new ArenaPhase({
      renderer: this.renderer,
      input: this.input,
      localPlayerId: LocalState.get().localPlayerId,
      fighters,
      onComplete: (result) => this.onArenaComplete(result),
    });
    this._swap(arena, 'ARENA');
    window.mcbDebug.arena = () => arena;
    window.mcbDebug.match = () => arena.match;
  }

  onArenaComplete(result) {
    const st = LocalState.get();
    const won = result.winnerPlayerId === st.localPlayerId;
    const reward = won ? result.winReward : result.loseReward;
    LocalState.setGold(st.gold + reward);
    console.log(`[MCB] arena complete — ${won ? 'WON' : 'LOST'} +${reward}g (reason: ${result.reason})`);
    this.enterLobby();
    this.phase?.toast?.(`${won ? 'Victory' : 'Defeat'}! +${reward} gold. (Total: ${LocalState.get().gold}g)`);
  }

  _loop() {
    this.phase?.update?.();
    requestAnimationFrame(this._loop);
  }
}

function pickOpponentMonster(myId) {
  const ids = ['pyroroc', 'aquaslug', 'voltkid', 'terrataur', 'galebird'].filter((x) => x !== myId);
  return ids[Math.floor(Math.random() * ids.length)];
}

/**
 * Lobby wrapped as a phase (scene + FPP + interaction + host console).
 */
class LobbyPhase {
  constructor(renderer, input, onStart) {
    this.renderer = renderer;
    this.input = input;
    this.lobby = new LobbyScene();
    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 200);
    this.controller = new FppController(this.camera, input, renderer.domElement, {
      x: 0, z: 6, boundaryRadius: this.lobby.boundaryRadius, eyeHeight: 1.6, speed: 4.2,
    });
    this.controller.yaw = 0;
    this.overlay = new Overlay();
    this.hostConsole = new HostConsole(onStart);
    this.clock = new THREE.Clock();

    this._subs = [
      input.onPress('KeyE', () => this._interact()),
      input.onPress('KeyR', () => { if (this.lobby.nearest?.type === 'mirror') { this.lobby.cycleTunic(); this.overlay.showToast('Tunic color changed'); } }),
      input.onPress('Tab', (e) => { e.preventDefault(); this.hostConsole.toggle(); }),
    ];
  }

  _interact() {
    const n = this.lobby.nearest;
    if (!n) return;
    if (n.type === 'pedestal') { this.lobby.bindMonster(n.monster); this.overlay.showToast(`Bound ${n.monster.name} (${n.monster.role})`); }
    else if (n.type === 'mirror') { this.lobby.cycleSkin(); this.overlay.showToast('Skin tone changed'); }
  }

  toast(msg) { this.overlay.showToast(msg, 4000); }

  update() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;
    this.controller.update(dt);
    this.lobby.update(dt, t);
    const n = this.lobby.updateNearest(this.controller.position);
    if (n?.type === 'pedestal') {
      const sel = LocalState.get().selectedMonsterId === n.monster.id;
      this.overlay.showPrompt(`Press <b>[E]</b> to ${sel ? 're-bind' : 'choose'} <b>${n.monster.name}</b> — ${n.monster.role}`);
    } else if (n?.type === 'mirror') {
      this.overlay.showPrompt(`<b>[E]</b> cycle skin · <b>[R]</b> cycle tunic`);
    } else this.overlay.hidePrompt();
    this.renderer.render(this.lobby.scene, this.camera);
  }

  dispose() {
    this._subs.forEach((off) => off());
    this.controller.dispose();
    this.overlay.dispose();
    this.hostConsole.dispose();
  }
}
